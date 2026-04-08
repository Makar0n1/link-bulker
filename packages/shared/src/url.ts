/**
 * URL utilities used by parser, matcher, API validation and UI.
 *
 * Matching rules (per product spec):
 *   - Acceptor is normalized to a host: lowercase, no `www.` prefix, no port.
 *   - Match is exact host equality. Subdomains do NOT match unless the user
 *     explicitly entered them as the acceptor.
 */

/**
 * Normalize a host: lowercase, strip leading "www.", strip port.
 */
export function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  // strip port
  const colon = h.indexOf(':');
  if (colon !== -1) h = h.slice(0, colon);
  // strip leading www.
  if (h.startsWith('www.')) h = h.slice(4);
  return h;
}

/**
 * Extract the acceptor host from arbitrary user input.
 *
 *   "https://www.studibucht.de/page?utm=1" -> "studibucht.de"
 *   "studibucht.de"                        -> "studibucht.de"
 *   "blog.studibucht.de"                   -> "blog.studibucht.de"
 *
 * Throws if the input cannot be parsed as a host.
 */
export function extractAcceptorHost(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error('Acceptor is empty');

  const candidates = [raw, `https://${raw}`];
  for (const candidate of candidates) {
    try {
      const u = new URL(candidate);
      if (u.hostname) return normalizeHost(u.hostname);
    } catch {
      // try next candidate
    }
  }
  throw new Error(`Cannot parse acceptor as URL: "${input}"`);
}

/**
 * Resolve a possibly-relative href against a base URL.
 * Returns null if resolution fails (e.g. mailto:, javascript:, malformed).
 */
export function resolveHref(href: string, baseUrl: string): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed) return null;
  // skip non-http schemes
  if (/^(mailto|tel|javascript|data|sms|ftp):/i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed, baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Extract host from a URL string, returns null if invalid.
 */
export function safeHost(url: string): string | null {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

/**
 * Validate that a string looks like a usable donor URL (http/https).
 */
export function isValidDonorUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
