// Utilitário para extrair primeiro nombre real del lead.
// Retorna null quando o "nombre" parece ser razão social / nombre de empresa,
// para a IA no tratar "Acesso Digital 360" como se fosse uma pessoa.

const COMPANY_TOKENS = [
  'agencia', 'agência', 'marketing', 'digital', 'studio', 'ltda', 'me',
  'eireli', 'consultoria', 'tecnologia', 'solutions', 'company', 'co.',
  'inc', 'corp', 'group', 'grupo', 'holding', 'oficial', 'enterprise',
  'tech', 'labs', 'lab', 'systems', 'system', 'comercio', 'comércio',
  'industria', 'indústria', 'servicos', 'serviços', 'imobiliaria',
  'imobiliária', 'construtora', 'logistica', 'logística', 'editora',
];

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function looksLikeCompany(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  // Tem dígito → quase siempre razão social ("Acesso Digital 360", "AG7")
  if (/\d/.test(t)) return true;
  const norm = stripDiacritics(t.toLowerCase());
  const tokens = norm.split(/\s+/).filter(Boolean);
  // Token de empresa em qualquer posição
  if (tokens.some((tok) => COMPANY_TOKENS.includes(tok))) return true;
  // 2+ palavras totalmente em CAIXA ALTA
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.every((w) => w === w.toUpperCase() && /[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(w))) {
    return true;
  }
  // Uma única "palavra" larga demais pra ser nombre ("AcessoDigital360")
  if (words.length === 1 && words[0].length > 18) return true;
  return false;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Retorna o primeiro nombre del lead (capitalizado), ou null se o input
 * parecer nombre de empresa / razão social / lixo.
 */
export function extractFirstName(raw?: string | null): string | null {
  if (!raw) return null;
  const cleaned = String(raw).trim();
  if (!cleaned) return null;
  // Teléfono puro / só dígitos
  if (/^[+\d\s().-]+$/.test(cleaned)) return null;
  if (looksLikeCompany(cleaned)) return null;
  const first = cleaned.split(/\s+/)[0].replace(/[^\p{L}\-']/gu, '');
  if (!first || first.length < 2) return null;
  return capitalize(first);
}

/**
 * Retorna nombre para exibir no prompt — "" quando no confiável.
 * Útil para `replaceAll('{{nombre}}', safeFirstName(visitorName))`.
 */
export function safeFirstName(raw?: string | null): string {
  return extractFirstName(raw) ?? '';
}
