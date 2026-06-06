// Shared AI router: resolves which provider/endpoint/key to use based on org_ai_routing
// + org_ai_credentials. Falls back to Lovable AI Gateway when external key missing
// (only if fallback_to_lovable=true).

const LOVABLE_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const OPENAI_CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_EMBEDDINGS_ENDPOINT = 'https://api.openai.com/v1/embeddings';
const OPENAI_TRANSCRIPTIONS_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_MODEL = 'google/gemini-3-flash-preview';

export type AICapability =
  | 'agent_chat'
  | 'sales_copilot'
  | 'audio_transcription'
  | 'image_vision'
  | 'content_generation'
  | 'analysis_insights'
  | 'embeddings';

export interface ResolvedAIConfig {
  endpoint: string;
  headers: Record<string, string>;
  model: string;
  provider: 'lovable' | 'openai' | string;
  source: 'external_key' | 'gateway' | 'fallback_gateway';
  // Whether retry on Lovable is allowed if external call fails (other than 429)
  allowFallback: boolean;
  apiKey: string;
  /** When the key came from the platform pool. */
  platform_key_id?: string;
  key_label?: string;
}


/**
 * Maps a Lovable-prefixed model to the equivalent for an external provider.
 * Used when org configured external provider but call site passes a Lovable model.
 */
const MODEL_MAP_TO_OPENAI: Record<string, string> = {
  'google/gemini-3-flash-preview': 'gpt-5-mini',
  'google/gemini-3.1-pro-preview': 'gpt-5',
  'google/gemini-2.5-flash': 'gpt-5-mini',
  'google/gemini-2.5-flash-lite': 'gpt-5-nano',
  'google/gemini-2.5-pro': 'gpt-5',
  'openai/gpt-5': 'gpt-5',
  'openai/gpt-5-mini': 'gpt-5-mini',
  'openai/gpt-5-nano': 'gpt-5-nano',
  'openai/gpt-5.2': 'gpt-5.2',
};

function adaptModelForProvider(model: string, provider: string): string {
  if (!model) return model;
  if (provider === 'openai') {
    if (MODEL_MAP_TO_OPENAI[model]) return MODEL_MAP_TO_OPENAI[model];
    if (model.startsWith('openai/')) return model.slice('openai/'.length);
    // Unknown prefix → strip provider prefix if present
    if (model.includes('/')) return model.split('/').pop()!;
    return model;
  }
  return model;
}

export function prepareAIRequestBody(body: Record<string, any>, cfg: ResolvedAIConfig): Record<string, any> {
  const payload: Record<string, any> = { ...body, model: cfg.model };

  if (cfg.provider === 'openai' && String(cfg.model || '').startsWith('gpt-5')) {
    if (payload.max_tokens !== undefined && payload.max_completion_tokens === undefined) {
      payload.max_completion_tokens = payload.max_tokens;
    }
    delete payload.max_tokens;
    if (payload.temperature !== undefined && payload.temperature !== 1) {
      delete payload.temperature;
    }
  }

  return payload;
}

/**
 * Resolves AI configuration for an organization.
 * - Reads org_ai_routing for the given capability (default 'agent_chat').
 * - If provider is external (openai) AND a credential exists, returns config to call that provider directly.
 * - Otherwise returns Lovable AI Gateway config.
 */
export async function resolveAIConfig(
  supabase: any,
  organizationId: string | null | undefined,
  capability: AICapability | string = 'agent_chat',
  /** Optional model hint from caller. Will be adapted if provider differs. */
  preferredModel?: string,
): Promise<ResolvedAIConfig> {
  const envLovableKey = Deno.env.get('LOVABLE_API_KEY') || '';

  /** Lê um plano efetivo da organização (provider/strategy/allow). */
  async function readPlan(): Promise<{ allow: boolean; provider: string; strategy: string }> {
    if (!organizationId) return { allow: true, provider: 'lovable', strategy: 'random' };
    try {
      const { data } = await supabase
        .from('organizations')
        .select('plan_id, platform_plans!inner(allow_platform_ai, platform_ai_provider, platform_ai_strategy)')
        .eq('id', organizationId)
        .maybeSingle();
      const plan = (data as any)?.platform_plans;
      return {
        allow: plan?.allow_platform_ai !== false,
        provider: (plan?.platform_ai_provider as string) || 'lovable',
        strategy: (plan?.platform_ai_strategy as string) || 'random',
      };
    } catch (e) {
      console.warn('[ai-router] readPlan failed, defaulting:', e);
      return { allow: true, provider: 'lovable', strategy: 'random' };
    }
  }

  /** Tenta escolher uma chave do pool da plataforma. Retorna null se vazio. */
  async function pickPoolKey(provider: string, strategy: string): Promise<{ id: string; api_key: string; model_default?: string; label: string } | null> {
    try {
      const { data, error } = await supabase.rpc('pick_platform_ai_key', { p_provider: provider, p_strategy: strategy });
      if (error) {
        console.warn('[ai-router] pick_platform_ai_key error:', error);
        return null;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;
      return { id: row.id, api_key: row.api_key_encrypted, model_default: row.model_default ?? undefined, label: row.label };
    } catch (e) {
      console.warn('[ai-router] pickPoolKey threw:', e);
      return null;
    }
  }

  function buildLovableConfig(apiKey: string, model: string, source: ResolvedAIConfig['source'], extra?: Partial<ResolvedAIConfig>): ResolvedAIConfig {
    return {
      endpoint: LOVABLE_GATEWAY,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      model,
      provider: 'lovable',
      source,
      allowFallback: false,
      apiKey,
      ...(extra || {}),
    };
  }

  function buildOpenAIConfig(apiKey: string, model: string, source: ResolvedAIConfig['source'], extra?: Partial<ResolvedAIConfig>): ResolvedAIConfig {
    return {
      endpoint: OPENAI_CHAT_ENDPOINT,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      model: adaptModelForProvider(model, 'openai'),
      provider: 'openai',
      source,
      allowFallback: false,
      apiKey,
      ...(extra || {}),
    };
  }

  // Fallback final: env LOVABLE_API_KEY (compat se pool lovable estiver vazio)
  const envLovableConfig: ResolvedAIConfig = buildLovableConfig(envLovableKey, preferredModel || DEFAULT_MODEL, 'gateway');

  if (!organizationId) return envLovableConfig;

  try {
    // 1) Roteamento configurado pela empresa (chave própria) tem prioridade
    const { data: routing } = await supabase
      .from('org_ai_routing')
      .select('provider, model, fallback_to_lovable')
      .eq('organization_id', organizationId)
      .eq('capability', capability)
      .maybeSingle();

    const orgProvider = (routing?.provider || '').toLowerCase();
    const routedModel = (routing?.model || preferredModel || DEFAULT_MODEL) as string;

    if (orgProvider && orgProvider !== 'lovable') {
      const { data: cred } = await supabase
        .from('org_ai_credentials')
        .select('api_key_encrypted')
        .eq('organization_id', organizationId)
        .eq('provider', orgProvider)
        .maybeSingle();
      const apiKey = cred?.api_key_encrypted as string | undefined;
      if (apiKey && orgProvider === 'openai') {
        return buildOpenAIConfig(apiKey, routedModel, 'external_key');
      }
      // sem chave própria → cai pro pool / plano abaixo
    }

    // 2) Plano da empresa decide se usa pool da plataforma
    const plan = await readPlan();
    if (!plan.allow) {
      const err: any = new Error(
        'Seu plano não inclui IA da plataforma. Cadastre uma chave própria (OpenAI/Anthropic/Gemini) em Integrações.',
      );
      err.code = 'AI_PLAN_NO_PLATFORM';
      throw err;
    }

    // 3) Tenta pool por estratégia
    const pool = await pickPoolKey(plan.provider, plan.strategy);
    if (pool) {
      const usedModel = preferredModel || pool.model_default || routedModel || DEFAULT_MODEL;
      const extra = { platform_key_id: pool.id, key_label: pool.label } as any;
      if (plan.provider === 'openai') return buildOpenAIConfig(pool.api_key, usedModel, 'gateway', extra);
      if (plan.provider === 'lovable') return buildLovableConfig(pool.api_key, usedModel, 'gateway', extra);
      // anthropic/gemini: hoje o roteador só sabe chamar OpenAI/Lovable; usamos chave do pool via Lovable Gateway como compat
      return buildLovableConfig(envLovableKey || pool.api_key, usedModel, 'gateway', extra);
    }

    // 4) Pool vazio
    if (plan.provider === 'lovable' && envLovableKey) {
      return { ...envLovableConfig, model: preferredModel || routedModel || DEFAULT_MODEL };
    }
    const err: any = new Error(
      `Pool da plataforma sem chaves ativas para "${plan.provider}". Peça ao Super Admin para cadastrar uma chave em Super Admin → IA da Plataforma.`,
    );
    err.code = 'AI_POOL_EMPTY';
    throw err;
  } catch (err: any) {
    if (['AI_NO_CREDENTIAL', 'AI_PLAN_NO_PLATFORM', 'AI_POOL_EMPTY'].includes(err?.code)) throw err;
    console.warn('[ai-router] Lookup failed, using env Lovable default:', err);
    return envLovableConfig;
  }
}


/**
 * Registra consumo de tokens da plataforma após chamada Lovable AI.
 * Para chave própria do cliente, apenas grava log informativo (não consome cota).
 */
export async function recordAIUsage(
  supabase: any,
  organizationId: string | null | undefined,
  cfg: ResolvedAIConfig,
  capability: string,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null,
  edgeFunction?: string,
): Promise<void> {
  if (!organizationId || !usage) return;
  const total = usage.total_tokens ?? ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0));
  try {
    const isPlatform = cfg.source === 'gateway' || cfg.source === 'fallback_gateway';
    if (isPlatform && total > 0) {
      await supabase.rpc('check_and_consume_ai_tokens', { p_org_id: organizationId, p_tokens: total });
    }
    await supabase.from('ai_usage_logs').insert({
      organization_id: organizationId,
      capability,
      provider: cfg.provider,
      model: cfg.model,
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: total,
      source: isPlatform ? 'platform' : 'own_key',
      edge_function: edgeFunction || null,
      platform_key_id: cfg.platform_key_id ?? null,
      key_label: cfg.key_label ?? null,
    });

  } catch (e) {
    console.warn('[ai-router] recordAIUsage failed (non-fatal):', e);
  }
}

/**
 * Atalho para chamadas diretas ao Lovable Gateway (raw fetch).
 * Equivale a recordAIUsage com cfg sintético source='gateway'.
 */
export async function recordLovableUsage(
  supabase: any,
  organizationId: string | null | undefined,
  capability: string,
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null,
  edgeFunction?: string,
): Promise<void> {
  if (!organizationId || !usage) return;
  const cfg: ResolvedAIConfig = {
    endpoint: '', headers: {}, apiKey: '', allowFallback: false,
    provider: 'lovable', source: 'gateway', model: model || 'unknown',
  };
  return recordAIUsage(supabase, organizationId, cfg, capability, usage, edgeFunction);
}

/**
 * Returns the embeddings endpoint config (OpenAI direct or Lovable fallback).
 * Lovable AI Gateway does not currently expose embeddings; if Lovable is selected
 * we still call OpenAI but require a key.
 */
export async function resolveEmbeddingsConfig(
  supabase: any,
  organizationId: string | null | undefined,
): Promise<ResolvedAIConfig> {
  const cfg = await resolveAIConfig(supabase, organizationId, 'embeddings', 'text-embedding-3-small');
  // Always call OpenAI embeddings endpoint regardless of provider routing,
  // unless we have an explicit OpenAI key.
  if (cfg.provider === 'openai') {
    return { ...cfg, endpoint: OPENAI_EMBEDDINGS_ENDPOINT, model: cfg.model || 'text-embedding-3-small' };
  }
  // Lovable doesn't support embeddings — try platform-level OPENAI_API_KEY as last resort.
  const fallbackKey = Deno.env.get('OPENAI_API_KEY');
  if (fallbackKey) {
    return {
      endpoint: OPENAI_EMBEDDINGS_ENDPOINT,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${fallbackKey}` },
      model: 'text-embedding-3-small',
      provider: 'openai',
      source: 'gateway',
      allowFallback: false,
      apiKey: fallbackKey,
    };
  }
  throw new Error('Embeddings requerem uma chave OpenAI configurada na organização ou na plataforma.');
}

/**
 * Returns transcription endpoint config (OpenAI Whisper / gpt-4o-transcribe).
 */
export async function resolveTranscriptionConfig(
  supabase: any,
  organizationId: string | null | undefined,
): Promise<ResolvedAIConfig> {
  const cfg = await resolveAIConfig(supabase, organizationId, 'audio_transcription', 'gpt-4o-transcribe');
  if (cfg.provider === 'openai') {
    return { ...cfg, endpoint: OPENAI_TRANSCRIPTIONS_ENDPOINT, model: cfg.model || 'gpt-4o-transcribe' };
  }
  const fallbackKey = Deno.env.get('OPENAI_API_KEY');
  if (fallbackKey) {
    return {
      endpoint: OPENAI_TRANSCRIPTIONS_ENDPOINT,
      headers: { Authorization: `Bearer ${fallbackKey}` },
      model: 'gpt-4o-transcribe',
      provider: 'openai',
      source: 'gateway',
      allowFallback: false,
      apiKey: fallbackKey,
    };
  }
  throw new Error('Transcrição requer uma chave OpenAI configurada.');
}

/**
 * Convenience logger so logs across all call sites look identical.
 */
export function logAIConfig(label: string, cfg: ResolvedAIConfig) {
  console.log(
    `[${label}] AI Provider: ${cfg.provider} | Model: ${cfg.model} | Source: ${cfg.source}`,
  );
}
