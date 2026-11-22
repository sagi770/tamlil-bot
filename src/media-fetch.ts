import { isSafePublicHttpsUrl } from './media-url.js';

export const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 15_000;

export type PreflightResult =
  | { ok: true; finalUrl: string; contentType: string; contentLength: number | null }
  | { ok: false; reason: 'fetch-failed' | 'unsafe-redirect' | 'too-many-redirects' | 'not-media' };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** HTML and other text responses are permission pages or interstitials, never media. */
function isAcceptedContentType(bareType: string): boolean {
  if (bareType === '') return true; // some file hosts omit it; Soniox sniffs the container
  if (bareType.startsWith('text/')) return false;
  if (bareType === 'application/xhtml+xml') return false;
  return true;
}

/** Drop the body unread so nothing downloads; a failing cancel never changes the result. */
function discardBody(res: Response): void {
  try {
    void Promise.resolve(res.body?.cancel()).catch(() => undefined);
  } catch {
    // ignore
  }
}

/**
 * Follows redirects by hand (every hop re-checked against the SSRF guard) and
 * inspects headers only. Never reads a body.
 */
export async function preflightMediaUrl(
  url: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<PreflightResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  // One deadline across all hops; AbortSignal.timeout leaves no timer that keeps the process alive.
  const signal = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let first: URL;
  try {
    first = new URL(url);
  } catch {
    return { ok: false, reason: 'fetch-failed' };
  }
  if (!isSafePublicHttpsUrl(first)) return { ok: false, reason: 'unsafe-redirect' };
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(current, { method: 'GET', redirect: 'manual', headers: { 'user-agent': 'tamlil-bot/1.0' }, signal });
    } catch {
      return { ok: false, reason: 'fetch-failed' };
    }
    discardBody(res);

    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get('location');
      if (!location) return { ok: false, reason: 'fetch-failed' };
      let target: URL;
      try {
        target = new URL(location, current);
      } catch {
        return { ok: false, reason: 'fetch-failed' };
      }
      if (!isSafePublicHttpsUrl(target)) return { ok: false, reason: 'unsafe-redirect' };
      current = target.href;
      continue;
    }

    if (!res.ok) return { ok: false, reason: 'fetch-failed' };

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!isAcceptedContentType(contentType)) return { ok: false, reason: 'not-media' };

    const rawLength = res.headers.get('content-length');
    const parsed = rawLength ? Number.parseInt(rawLength, 10) : Number.NaN;
    const contentLength = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    return { ok: true, finalUrl: current, contentType, contentLength };
  }

  return { ok: false, reason: 'too-many-redirects' };
}
