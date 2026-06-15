/**
 * Regional formatters — currently locked to Paraguay (es-PY / PYG / DDI 595).
 * Centralizes currency/date/phone display so we can extend later to AR/MX/etc.
 */

export const REGION = {
  locale: 'es-PY',
  currency: 'PYG',
  currencySymbol: '₲',
  dialCode: '+595',
  country: 'PY',
  flag: '🇵🇾',
} as const;

/** Format a number as Paraguayan Guaraní (no decimals). */
export function formatCurrency(value: number | null | undefined, opts?: Intl.NumberFormatOptions): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat(REGION.locale, {
    style: 'currency',
    currency: REGION.currency,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    ...opts,
  }).format(n);
}

/** Compact currency for cards (e.g. ₲ 1,2M). */
export function formatCurrencyCompact(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat(REGION.locale, {
    style: 'currency',
    currency: REGION.currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

/** Format a number with regional grouping. */
export function formatNumber(value: number | null | undefined, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(REGION.locale, opts).format(Number(value ?? 0));
}

/** Date short: dd/MM/yyyy */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString(REGION.locale);
}

/** Datetime short. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleString(REGION.locale);
}

/**
 * Normalize a phone to E.164 for Paraguay (DDI 595).
 * - Strips non-digits.
 * - If the user typed 0 first (national trunk), drops it.
 * - Prepends 595 unless already present.
 */
export function normalizePhonePY(input: string): string {
  let d = (input || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('595')) return d;
  if (d.startsWith('0')) d = d.slice(1);
  return `595${d}`;
}

/** Display a PY phone as +595 9XX XXX XXX. */
export function formatPhonePY(input: string): string {
  const d = normalizePhonePY(input);
  if (!d.startsWith('595')) return input;
  const rest = d.slice(3);
  if (rest.length <= 3) return `+595 ${rest}`;
  if (rest.length <= 6) return `+595 ${rest.slice(0, 3)} ${rest.slice(3)}`;
  return `+595 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6, 9)}`;
}
