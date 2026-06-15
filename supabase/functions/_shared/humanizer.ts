// Humanization engine — Phase 1
// Applies style transforms, splits responses into bubbles, and computes
// human-like delays for AI agent messages.
//
// Pure module — no IO, no DB. Safe to use in any edge function.

export type HumanizationChannel =
  | 'whatsapp'
  | 'webchat'
  | 'chat'
  | 'instagram'
  | 'facebook'
  | 'inbox';

export interface TimingConfig {
  enabled?: boolean;
  first_reply_min_s?: number;
  first_reply_max_s?: number;
  between_bubbles_min_s?: number;
  between_bubbles_max_s?: number;
  typing_indicator?: boolean;
  vary_by_hours?: boolean;
  no_reply_dawn?: boolean;
  vary_by_channel?: boolean;
}

export interface SplittingConfig {
  enabled?: boolean;
  aggressiveness?: 1 | 2 | 3 | 4 | 5 | number;
  min_bubbles?: number;
  max_bubbles?: number;
}

export interface StyleConfig {
  lowercase_prob?: number;       // 0..1
  relaxed_punct_prob?: number;   // 0..1
  abbrev_prob?: number;          // 0..1
  abbreviations?: string;        // "original=abreviado" per line
  typo_correction_prob?: number; // 0..1
  laughter_prob?: number;        // 0..1
  laughter_style?: 'kkk' | 'rs' | 'haha' | 'kk' | 'auto';
  emoji_density?: 'none' | 'low' | 'medium' | 'high';
}

export interface PersonaStory {
  title: string;
  description: string;
}

export interface PersonaConfig {
  age?: number | null;
  city?: string;
  backstory?: string;
  hobbies?: string[];           // up to 5
  stories?: PersonaStory[];     // up to 5
  loved_words?: string[];
  forbidden_words?: string[];
}

export type LinguisticRegion =
  | 'neutral' | 'paulista' | 'carioca' | 'nordestino' | 'sulista' | 'mineiro' | 'custom';

export interface TicsConfig {
  region?: LinguisticRegion;
  slang?: string[];           // modismos específicas
  openers?: string[];         // interjeições de abertura
  connectors?: string[];      // conectivos casuais
  fillers?: string[];         // frases de muleta
}

export type ReactionTriggerType = 'inactive_hours' | 'message_type' | 'keyword';
export type ReactionMessageType = 'audio' | 'sticker' | 'emoji_only' | 'image' | 'video';
export type ReactionAction = 'reply' | 'context';

export interface ReactionRule {
  id: string;
  enabled?: boolean;
  label?: string;
  type: ReactionTriggerType;
  // inactive_hours
  hours?: number;
  // message_type
  message_type?: ReactionMessageType;
  // keyword
  keywords?: string[];
  match?: 'any' | 'all';
  // action
  action: ReactionAction;
  reply?: string;       // direct reply text (skips AI)
  context?: string;     // injected into prompt before AI generation
}

export interface ReactionsConfig {
  enabled?: boolean;
  rules?: ReactionRule[];
}

export interface HumanizationConfig {
  enabled?: boolean;
  timing?: TimingConfig;
  splitting?: SplittingConfig;
  style?: StyleConfig;
  persona?: PersonaConfig;
  tics?: TicsConfig;
  reactions?: ReactionsConfig;
}

export interface HumanizeResult {
  bubbles: string[];
  firstDelayMs: number;
  betweenDelaysMs: number[];      // length === bubbles.length - 1
  typingMsPerBubble: number[];    // length === bubbles.length
  typingIndicator: boolean;
  postponeUntil?: string | null;  // ISO if no_reply_dawn fired
}

// ───────────────────────────── helpers ──────────────────────────────

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const chance = (p: number) => Math.random() < clamp(p ?? 0, 0, 1);

const DEFAULT_ABBREVS: Record<string, string> = {
  'usted': 'vc',
  'voces': 'vcs',
  'usted é': 'vc é',
  'también': 'tbm',
  'porque': 'pq',
  'por que': 'pq',
  'está': 'tá',
  'estou': 'tô',
  'beleza': 'blz',
  'todo bien': 'tdbm',
  'para': 'pra',
  'que': 'q',
  'no': 'n',
};

function parseAbbreviations(raw?: string): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_ABBREVS };
  if (!raw) return out;
  for (const line of raw.split(/\n+/)) {
    const [a, b] = line.split('=').map((s) => s?.trim());
    if (a && b) out[a.toLowerCase()] = b;
  }
  return out;
}

// ───────────────────────────── style ────────────────────────────────

export function applyStyle(input: string, style: StyleConfig = {}): string {
  let text = (input ?? '').trim();
  if (!text) return text;

  // 1. Abbreviations (per word/phrase, probabilistic)
  const abbrevs = parseAbbreviations(style.abbreviations);
  if ((style.abbrev_prob ?? 0) > 0) {
    // Sort by length desc to match "todo bien" before "tudo"
    const keys = Object.keys(abbrevs).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      const re = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      text = text.replace(re, (match) => {
        if (!chance(style.abbrev_prob!)) return match;
        const repl = abbrevs[key];
        // preserve capitalization roughly
        return match[0] === match[0].toUpperCase()
          ? repl[0].toUpperCase() + repl.slice(1)
          : repl;
      });
    }
  }

  // 2. Lowercase first letter of sentences
  if ((style.lowercase_prob ?? 0) > 0) {
    text = text.replace(/(^|[.!?]\s+)([A-ZÁÉÍÓÚÂÊÔÃÕÇ])/g, (_m, sep, ch) =>
      chance(style.lowercase_prob!) ? sep + ch.toLowerCase() : sep + ch
    );
  }

  // 3. Relaxed punctuation — drop trailing period probabilistically
  if ((style.relaxed_punct_prob ?? 0) > 0) {
    text = text
      .split(/\n+/)
      .map((line) => {
        if (chance(style.relaxed_punct_prob!)) return line.replace(/\.$/g, '').replace(/,(\s)/g, '$1');
        return line;
      })
      .join('\n');
  }

  // 4. Laughter — só em contextos leves de verdade (evita "kkk" colado em frase neutra).
  if ((style.laughter_prob ?? 0) > 0 && chance(style.laughter_prob!)) {
    const lightSignals = /(\p{Extended_Pictographic}|!|nuestra|cara|véi|vei|kkk|haha|engraçad|doido|loucura|de boa|tranqui|sussa|massa)/iu;
    const alreadyHasLaughter = /(kkk|haha|rs|kk)\s*[.!?]?\s*$/i.test(text);
    if (lightSignals.test(text) && !alreadyHasLaughter) {
      const styleChoice = (() => {
        const s = style.laughter_style ?? 'auto';
        if (s !== 'auto') return s;
        const opts = ['kkk', 'rs', 'haha', 'kk'];
        return opts[Math.floor(Math.random() * opts.length)];
      })();
      text = text.replace(/[.!?\s]*$/, '') + ' ' + styleChoice;
    }
  }

  // 5. Emoji density — strip excess emojis to match config
  const emojiRegex = /\p{Extended_Pictographic}/gu;
  const emojis = text.match(emojiRegex) ?? [];
  const target =
    style.emoji_density === 'none' ? 0 :
    style.emoji_density === 'low' ? 1 :
    style.emoji_density === 'medium' ? 3 :
    style.emoji_density === 'high' ? 6 : emojis.length;
  if (emojis.length > target) {
    let removed = 0;
    text = text.replace(emojiRegex, (e) => {
      const remaining = emojis.length - removed;
      if (remaining > target) {
        removed++;
        return '';
      }
      return e;
    });
  }

  return text.trim();
}

// ─────────────────────────── splitting ───────────────────────────────

export function splitIntoBubbles(text: string, cfg: SplittingConfig = {}): string[] {
  const t = (text ?? '').trim();
  if (!t) return [];
  const enabled = cfg.enabled !== false;
  if (!enabled) return [t];

  const aggr = clamp(cfg.aggressiveness ?? 3, 1, 5);
  const minB = Math.max(1, cfg.min_bubbles ?? 1);
  const maxB = Math.max(minB, cfg.max_bubbles ?? 6);

  if (aggr === 1) return [t];
  if (aggr === 2 && t.length <= 200) return [t];

  // Tamanho-alvo por bolha conforme aggressiveness (estilo WhatsApp).
  const targetLen = aggr >= 5 ? 100 : aggr === 4 ? 140 : aggr === 3 ? 180 : 220;

  // Quebra primária: por sentença (.!?) e quebras de linha.
  const sentences = t
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Fallback cuando a IA mandou todo numa frase só ("frase, frase, frase, frase").
  // Quebrar por vírgula / ponto-e-vírgula / conjunções leves preservando ordem.
  let units: string[] = sentences;
  if (sentences.length <= 1 && t.length > targetLen) {
    units = t
      .split(/(?<=[;])\s+|,\s+(?=(?:mas|então|entao|aí|ai|e aí|e ai|porém|porem|porque|tipo|sabe)\b)|,\s+/i)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (units.length <= 1) return [t];

  // Junta unidades curtas hasta bater ~targetLen; nunca passa de maxB bolhas.
  const bubbles: string[] = [];
  let current = '';
  for (const u of units) {
    if (!current) {
      current = u;
      continue;
    }
    if ((current.length + 1 + u.length) <= targetLen) {
      current += (current.endsWith(',') || current.endsWith(';')) ? ' ' + u : ' ' + u;
    } else {
      bubbles.push(current);
      current = u;
    }
  }
  if (current) bubbles.push(current);

  // Se ficou abaixo do mínimo, devolve do jeito que está.
  // Se passou do máximo, mescla as últimas hasta caber.
  while (bubbles.length > maxB) {
    const last = bubbles.pop()!;
    bubbles[bubbles.length - 1] += ' ' + last;
  }
  if (bubbles.length < minB) return [t];
  return bubbles.filter((b) => b.trim().length > 0);
}

// ────────────────────────────── delays ───────────────────────────────

function channelMultiplier(channel: HumanizationChannel, vary: boolean): number {
  if (!vary) return 1;
  switch (channel) {
    case 'whatsapp': return 1;
    case 'webchat':
    case 'chat': return 0.5;
    case 'instagram':
    case 'facebook': return 1.2;
    default: return 1;
  }
}

function hoursMultiplier(date: Date, vary: boolean): number {
  if (!vary) return 1;
  const h = date.getHours();
  if (h >= 8 && h < 18) return 1;
  return 1.5; // off-hours: leve aumento (antes era 2x — gerava esperas absurdas)
}

// Hard caps de servidor: protegem contra configs antigas con 90s, etc.
// Esses limites NUNCA son ultrapassados, mismo se o JSON del agente dice o contrário.
const HARD_FIRST_MIN_MS = 1500;
const HARD_FIRST_MAX_MS = 15000;
const HARD_BETWEEN_MIN_MS = 600;
const HARD_BETWEEN_MAX_MS = 6000;

function clampMs(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

export function computeDelays(
  bubbles: string[],
  cfg: TimingConfig = {},
  channel: HumanizationChannel = 'whatsapp',
  now: Date = new Date()
): { firstMs: number; betweenMs: number[]; typingMs: number[]; postponeUntil: string | null } {
  const enabled = cfg.enabled !== false;
  const cMul = channelMultiplier(channel, cfg.vary_by_channel !== false);
  const hMul = hoursMultiplier(now, cfg.vary_by_hours !== false);
  const mul = cMul * hMul;

  // Dawn block (0h-6h) → schedule for 8h
  let postponeUntil: string | null = null;
  if (cfg.no_reply_dawn && now.getHours() < 6) {
    const sched = new Date(now);
    sched.setHours(8, 0, 0, 0);
    postponeUntil = sched.toISOString();
  }

  const firstMin = cfg.first_reply_min_s ?? 4;
  const firstMax = cfg.first_reply_max_s ?? 12;
  const betweenMin = cfg.between_bubbles_min_s ?? 1;
  const betweenMax = cfg.between_bubbles_max_s ?? 4;

  const firstRaw = enabled ? rand(firstMin, firstMax) * 1000 * mul : 0;
  const firstMs = enabled ? clampMs(firstRaw, HARD_FIRST_MIN_MS, HARD_FIRST_MAX_MS) : 0;
  const betweenMs: number[] = [];
  for (let i = 0; i < Math.max(0, bubbles.length - 1); i++) {
    const raw = enabled ? rand(betweenMin, betweenMax) * 1000 * mul : 0;
    betweenMs.push(enabled ? clampMs(raw, HARD_BETWEEN_MIN_MS, HARD_BETWEEN_MAX_MS) : 0);
  }

  // Typing time per bubble: ~40 chars/s
  const typingMs = bubbles.map((b) => Math.min(8000, Math.round((b.length / 40) * 1000)));

  return { firstMs, betweenMs, typingMs, postponeUntil };
}

// ───────────────────────────── orchestrator ──────────────────────────

export function humanize(
  text: string,
  config: HumanizationConfig | undefined | null,
  channel: HumanizationChannel = 'whatsapp',
  now: Date = new Date()
): HumanizeResult {
  const cfg = config ?? {};
  const enabled = cfg.enabled !== false;

  // 1. Style
  const styled = enabled ? applyStyle(text, cfg.style ?? {}) : text;

  // 2. Split
  const bubbles = enabled ? splitIntoBubbles(styled, cfg.splitting ?? {}) : [styled];

  // 3. Optional typo+correction (probabilistic)
  const typoProb = cfg.style?.typo_correction_prob ?? 0;
  if (enabled && typoProb > 0 && bubbles.length > 0 && chance(typoProb)) {
    const idx = Math.floor(Math.random() * bubbles.length);
    const original = bubbles[idx];
    const words = original.split(/\s+/);
    if (words.length > 2) {
      const wIdx = Math.floor(Math.random() * words.length);
      const w = words[wIdx];
      if (w.length > 3) {
        const broken = w.slice(0, -2) + w.slice(-1); // drop one letter near end
        words[wIdx] = broken;
        bubbles[idx] = words.join(' ');
        bubbles.splice(idx + 1, 0, `${w}* haha`);
      }
    }
  }

  // 4. Delays
  const t = computeDelays(bubbles, cfg.timing ?? {}, channel, now);

  return {
    bubbles,
    firstDelayMs: t.firstMs,
    betweenDelaysMs: t.betweenMs,
    typingMsPerBubble: t.typingMs,
    typingIndicator: cfg.timing?.typing_indicator !== false,
    postponeUntil: t.postponeUntil,
  };
}

// ───────────────────────── defaults by agent type ─────────────────────

export function defaultsForAgentType(agentType: string): HumanizationConfig {
  const base: HumanizationConfig = {
    enabled: true,
    timing: {
      enabled: true,
      first_reply_min_s: 4,
      first_reply_max_s: 12,
      between_bubbles_min_s: 1,
      between_bubbles_max_s: 4,
      typing_indicator: true,
      vary_by_hours: false,
      no_reply_dawn: false,
      vary_by_channel: true,
    },
    splitting: { enabled: true, aggressiveness: 3, min_bubbles: 1, max_bubbles: 6 },
    style: {
      lowercase_prob: 0.6,
      relaxed_punct_prob: 0.4,
      abbrev_prob: 0.5,
      abbreviations: 'usted=vc\ntambém=tbm\nporque=pq\nestá=tá\nbeleza=blz',
      typo_correction_prob: 0.05,
      laughter_prob: 0.15,
      laughter_style: 'auto',
      emoji_density: 'low',
    },
    reactions: { enabled: true, rules: DEFAULT_REACTION_RULES },
  };

  if (agentType === 'sdr') {
    base.style!.abbrev_prob = 0.65;
    base.style!.laughter_prob = 0.18;
    base.splitting!.aggressiveness = 4;
  } else if (agentType === 'closer') {
    base.style!.abbrev_prob = 0.35;
    base.style!.laughter_prob = 0.12;
    base.style!.lowercase_prob = 0.45;
    base.splitting!.aggressiveness = 3;
  } else if (agentType === 'support') {
    base.timing!.first_reply_min_s = 4;
    base.timing!.first_reply_max_s = 15;
    base.timing!.between_bubbles_min_s = 2;
    base.timing!.between_bubbles_max_s = 6;
    base.style!.laughter_prob = 0.08;
    base.style!.abbrev_prob = 0.3;
  }

  return base;
}

// ─────────────── prompt block builder (persona + tics + style) ────────────

const REGION_HINTS: Record<LinguisticRegion, string> = {
  neutral: 'español brasileiro neutro, sin regionalismo forte',
  paulista: 'sotaque paulista (mano, tipo, então, daí)',
  carioca: 'sotaque carioca (cara, véi, mermão, maneiro)',
  nordestino: 'sotaque nordestino (oxe, vixe, massa, arretado)',
  sulista: 'sotaque sulista/gaúcho (tchê, bah, guri, capaz)',
  mineiro: 'sotaque mineiro (uai, sô, trem, dimais)',
  custom: 'estilo regional customizado conforme as modismos listadas',
};

function bulletList(items?: string[], max = 12): string {
  if (!items || items.length === 0) return '';
  return items.slice(0, max).map((i) => `- ${i}`).join('\n');
}

/**
 * Builds a textual block to APPEND to the agent's system prompt so the LLM
 * already produces text in a humanized voice (persona, regional vocabulary,
 * style hints). Post-processing (splitting + delays) still runs on top.
 */
export function buildHumanizationPromptBlock(cfg?: HumanizationConfig | null): string {
  if (!cfg || cfg.enabled === false) return '';
  const out: string[] = [];
  out.push('\n\n🧑 PERSONA HUMANA (seguila ESTRICTAMENTE — sos una persona real, no un bot):');

  // ─── Persona ─────────────────────────────────────────────────────
  const p = cfg.persona ?? {};
  const personaLines: string[] = [];
  if (p.age) personaLines.push(`- Edad: ${p.age} años`);
  if (p.city) personaLines.push(`- Ciudad/región: ${p.city}`);
  if (p.backstory) personaLines.push(`- Historia profesional: ${p.backstory}`);
  if (p.hobbies && p.hobbies.length > 0) {
    personaLines.push(`- Hobbies/intereses: ${p.hobbies.slice(0, 5).join(', ')}`);
  }
  if (personaLines.length > 0) {
    out.push('\nQUIÉN SOS:\n' + personaLines.join('\n'));
  }

  if (p.stories && p.stories.length > 0) {
    const stories = p.stories
      .slice(0, 5)
      .map((s) => `- ${s.title}: ${s.description}`)
      .join('\n');
    out.push(
      '\nHISTORIAS PERSONALES QUE PODÉS MENCIONAR (usalas SOLO cuando tenga sentido natural en la conversación, NUNCA las fuerces):\n' +
      stories
    );
  }

  if (p.loved_words && p.loved_words.length > 0) {
    out.push(`\nPalabras que te ENCANTA usar (encajalas naturalmente cuando corresponda): ${p.loved_words.join(', ')}.`);
  }
  if (p.forbidden_words && p.forbidden_words.length > 0) {
    out.push(`\n🚫 Palabras PROHIBIDAS — NUNCA las usás: ${p.forbidden_words.join(', ')}.`);
  }

  // ─── Tics & slang ────────────────────────────────────────────────
  const t = cfg.tics ?? {};
  const region = t.region ?? 'neutral';
  out.push(`\nREGIÓN LINGÜÍSTICA: ${REGION_HINTS[region]}.`);
  if (t.slang && t.slang.length > 0) {
    out.push(`Modismos de tu repertorio (usá 1-2 por mensaje cuando corresponda, jamás todos juntos): ${t.slang.slice(0, 20).join(', ')}.`);
  }
  if (t.openers && t.openers.length > 0) {
    out.push(`Formas de iniciar una respuesta (variá, no repitas la misma siempre): ${t.openers.join(', ')}.`);
  }
  if (t.connectors && t.connectors.length > 0) {
    out.push(`Conectores casuales que usás: ${t.connectors.join(', ')}.`);
  }
  if (t.fillers && t.fillers.length > 0) {
    out.push(`Frases muletila para cuando necesitás "pensar":\n${bulletList(t.fillers, 10)}`);
  }

  // ─── Style hints (so the LLM already produces lowercase / abbrevs) ──
  const s = cfg.style ?? {};
  const styleLines: string[] = [];
  if ((s.lowercase_prob ?? 0) >= 0.3) {
    styleLines.push('- Empezá algunas frases con minúscula (estilo informal de WhatsApp).');
  }
  if ((s.relaxed_punct_prob ?? 0) >= 0.3) {
    styleLines.push('- Usá puntuación relajada: podés omitir el punto final en mensajes cortos.');
  }
  if ((s.abbrev_prob ?? 0) >= 0.3) {
    styleLines.push('- Usá abreviaciones naturales cuando corresponda: q, tmb, pq, ta, dale, pa.');
  }
  if ((s.laughter_prob ?? 0) >= 0.3) {
    const which = s.laughter_style && s.laughter_style !== 'auto' ? s.laughter_style : 'jaja/jeje/haha';
    styleLines.push(`- En momentos livianos, usá risas cortas (${which}). No exageres.`);
  }
  const ed = s.emoji_density ?? 'low';
  if (ed === 'none') styleLines.push('- NO uses emojis.');
  else if (ed === 'low') styleLines.push('- Usá como máximo 1 emoji por respuesta, y solo cuando tenga sentido.');
  else if (ed === 'medium') styleLines.push('- Usá 1-3 emojis por respuesta cuando corresponda.');
  else if (ed === 'high') styleLines.push('- Podés usar varios emojis (3-6) cuando el tono sea distendido.');

  if (styleLines.length > 0) {
    out.push('\nESTILO DE ESCRITURA:\n' + styleLines.join('\n'));
  }

  out.push(
    '\n📱 FORMATO DE MENSAJE (estilo WhatsApp REAL — OBLIGATORIO):' +
    '\n- Escribí en frases CORTAS, separadas por punto final, interrogación o salto de línea.' +
    '\n- NUNCA mandes un párrafo largo de una sola vez. Cada idea en una frase propia, terminada por ".", "?" o "!".' +
    '\n- Evitá frases con más de 18 palabras. Si queda larga, partila en dos.' +
    '\n- Usá "jaja", "je" o "haha" SOLO cuando haya algo realmente liviano/gracioso. NUNCA como tic al final de cada frase.'
  );

  out.push(
    '\n⚠️ IMPORTANTE: nunca digas ni insinúes que sos un bot, IA o asistente virtual a menos que el lead te pregunte directamente. Sos una persona real del equipo.' +
    '\n⚠️ NUNCA reconozcas verbalmente bugs, fallas técnicas, repetición de mensajes ni que la señal/sistema "se trabó". Si algo parece extraño, ignoralo y seguí la conversación naturalmente.'
  );

  return out.join('\n');
}

// ─────────────── Reactions: contextual pre-processor (Phase 3) ────────

const EMOJI_ONLY_RE = /^[\s\p{Extended_Pictographic}\p{Emoji_Presentation}\u200d\uFE0F]+$/u;

export function detectMessageType(text: string): ReactionMessageType | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  if (/🎙️|\[áudio\]|\[audio\]|áudio del cliente/i.test(t)) return 'audio';
  if (/\[sticker\]|\[figurinha\]/i.test(t)) return 'sticker';
  if (/\[imagen\]|\[image\]|🖼️/i.test(t)) return 'image';
  if (/\[v[ií]deo\]|\[video\]/i.test(t)) return 'video';
  // strip whatsapp/markdown wrappers then test emoji-only
  const stripped = t.replace(/[*_~`>]/g, '').trim();
  if (stripped.length > 0 && stripped.length <= 20 && EMOJI_ONLY_RE.test(stripped)) return 'emoji_only';
  return null;
}

export interface ReactionInput {
  text: string;
  messageType?: ReactionMessageType | null;
  /** ISO timestamp of the last visitor message BEFORE the current one (or last bot message). */
  lastInteractionAt?: string | null;
  now?: Date;
}

export interface ReactionMatch {
  rule: ReactionRule;
  /** When 'reply' the AI call is skipped and this text is sent. When 'context' it's injected into the system prompt. */
  kind: ReactionAction;
  text: string;
}

export function detectReaction(
  input: ReactionInput,
  cfg?: ReactionsConfig | null
): ReactionMatch | null {
  if (!cfg || cfg.enabled === false) return null;
  const rules = (cfg.rules ?? []).filter((r) => r && r.enabled !== false);
  if (rules.length === 0) return null;

  const text = (input.text ?? '').trim();
  const lower = text.toLowerCase();
  const detectedType = input.messageType ?? detectMessageType(text);
  const now = input.now ?? new Date();
  const inactiveMs = input.lastInteractionAt
    ? now.getTime() - new Date(input.lastInteractionAt).getTime()
    : null;

  for (const rule of rules) {
    let matched = false;
    if (rule.type === 'inactive_hours') {
      const need = (rule.hours ?? 0) * 3600 * 1000;
      if (need > 0 && inactiveMs !== null && inactiveMs >= need) matched = true;
    } else if (rule.type === 'message_type') {
      if (rule.message_type && detectedType === rule.message_type) matched = true;
    } else if (rule.type === 'keyword') {
      const kws = (rule.keywords ?? []).map((k) => k.toLowerCase().trim()).filter(Boolean);
      if (kws.length > 0) {
        const mode = rule.match ?? 'any';
        matched = mode === 'all' ? kws.every((k) => lower.includes(k)) : kws.some((k) => lower.includes(k));
      }
    }
    if (matched) {
      const payload = rule.action === 'reply' ? (rule.reply ?? '') : (rule.context ?? '');
      if (!payload.trim()) continue; // empty action — skip
      return { rule, kind: rule.action, text: payload };
    }
  }
  return null;
}

export const DEFAULT_REACTION_RULES: ReactionRule[] = [
  {
    id: 'r-emoji',
    enabled: true,
    label: 'Lead respondió solo con emoji',
    type: 'message_type',
    message_type: 'emoji_only',
    action: 'context',
    context: 'El lead acaba de responder SOLO con un emoji. Reaccioná de forma corta y natural (1 línea) y hacé una pregunta liviana para destrabar la conversación.',
  },
  {
    id: 'r-audio',
    enabled: true,
    label: 'Lead mandó audio',
    type: 'message_type',
    message_type: 'audio',
    action: 'context',
    context: 'El lead envió un audio (recibiste la transcripción). Comentá brevemente ("entendí tu audio…") antes de responder, sonando humano.',
  },
  {
    id: 'r-sticker',
    enabled: true,
    label: 'Lead mandó sticker',
    type: 'message_type',
    message_type: 'sticker',
    action: 'reply',
    reply: 'jaja buena 😄',
  },
  {
    id: 'r-bot-suspicion',
    enabled: true,
    label: 'Lead sospecha que sos un bot',
    type: 'keyword',
    keywords: ['sos un bot', 'sos un robot', 'sos una ia', 'sos inteligencia artificial', 'sos humano', '¿sos humano?', 'eres un bot', 'eres humano'],
    match: 'any',
    action: 'context',
    context: 'El lead desconfía si sos bot/IA. NO lo confirmes ni lo niegues mecánicamente — respondé de forma humana y natural, cambiá de tema con una pregunta personal o volvé a lo que estaba buscando.',
  },
  {
    id: 'r-busy',
    enabled: true,
    label: 'Lead dijo que está ocupado',
    type: 'keyword',
    keywords: ['ocupado', 'sin tiempo', 'después hablamos', 'ahora no puedo', 'en reunión', 'en una reunion'],
    match: 'any',
    action: 'reply',
    reply: '¡tranqui! ¿cuál es el mejor horario para hablarte más tarde?',
  },
  {
    id: 'r-apology',
    enabled: true,
    label: 'Lead pidió disculpas por la demora',
    type: 'keyword',
    keywords: ['perdón la demora', 'perdón por demorar', 'disculpá la demora', 'disculpa la demora', 'tardé en responder'],
    match: 'any',
    action: 'context',
    context: 'El lead pidió disculpas por la demora en responder. Acogelo de forma liviana ("imaginate, sin drama") antes de continuar la conversación.',
  },
  {
    id: 'r-inactive-24h',
    enabled: false,
    label: 'Lead volvió tras 24h de silencio',
    type: 'inactive_hours',
    hours: 24,
    action: 'context',
    context: 'El lead estuvo más de 24h sin responder y ahora volvió. Retomá el contexto de la última conversación de forma natural, sin reclamar.',
  },
  {
    id: 'r-grupo-entrou',
    enabled: true,
    label: 'Lead confirmó que entró al grupo / vivo / canal',
    type: 'keyword',
    keywords: [
      'entré al grupo', 'entré ahora al grupo', 'entré ahora', 'estoy en el grupo',
      'ya entré', 'ya estoy en el grupo', 'entré al vivo', 'entré al canal',
    ],
    match: 'any',
    action: 'context',
    context: 'El lead YA ENTRÓ al grupo/vivo/canal (CTA cumplida). PARÁ de calificar, PARÁ de explicar el producto, NO hagas una pregunta nueva. Mandá UN único mensaje corto reforzando que vale la pena estar atento allá y CERRÁ el turno.',
  },
];
