/** Locale negotiation without dependencies. Pure functions, safe for the proxy and tests. */

const MAX_HEADER_LENGTH = 1024;
const MAX_TAGS = 20;

/** Language tags from an Accept-Language header, best first. Wildcards and q=0 are ignored. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header || header.length > MAX_HEADER_LENGTH) return [];
  const ranked: { tag: string; quality: number; order: number }[] = [];
  header.split(',').slice(0, MAX_TAGS).forEach((part, order) => {
    const [rawTag, ...params] = part.trim().split(';');
    const tag = rawTag!.trim().toLowerCase();
    if (!/^[a-z]{1,8}(-[a-z0-9]{1,8})*$/.test(tag)) return;
    let quality = 1;
    for (const param of params) {
      const match = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(param);
      if (match) quality = Number(match[1]);
    }
    if (Number.isFinite(quality) && quality > 0 && quality <= 1) ranked.push({ tag, quality, order });
  });
  return ranked.sort((a, b) => b.quality - a.quality || a.order - b.order).map(item => item.tag);
}

/** Exact tag first, then the same language (es-AR → es). Returns undefined when nothing fits. */
export function matchLocale(requested: string[], enabled: readonly string[]): string | undefined {
  const lower = new Map(enabled.map(code => [code.toLowerCase(), code] as const));
  for (const tag of requested) {
    const exact = lower.get(tag);
    if (exact) return exact;
    const language = tag.split('-')[0]!;
    const base = lower.get(language);
    if (base) return base;
  }
  return undefined;
}

export interface NegotiationInput {
  /** Value of the NEXT_LOCALE cookie, when present. */
  cookie?: string | null;
  acceptLanguage?: string | null;
  enabled: readonly string[];
  fallback: string;
}

/** Saved choice → browser preference → installation default. */
export function negotiateLocale({ cookie, acceptLanguage, enabled, fallback }: NegotiationInput): string {
  if (cookie && enabled.includes(cookie)) return cookie;
  return matchLocale(parseAcceptLanguage(acceptLanguage), enabled) ?? fallback;
}
