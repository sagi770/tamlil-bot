// Bodies of src/http.ts. tests/scripts/probe.test.ts runs the real handler, so a change there fails the test.
const OUR_UNAUTHORIZED = 'unauthorized';
const OUR_SERVER_ERROR = 'server error';

export interface ProbeResponse {
  status: number;
  contentType: string;
  body: string;
  location: string;
}

/**
 * ours: our handler rejected the request without the secret, as it should.
 * protected: Vercel Deployment Protection answered instead of our function.
 * config-error: our function runs but its environment variables are incomplete.
 */
export type ProbeVerdict = 'ours' | 'protected' | 'config-error' | 'not-found' | 'unexpected';

export async function readProbe(res: Response): Promise<ProbeResponse> {
  const body = res.status >= 300 && res.status < 400 ? '' : await res.text().catch(() => '');
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    body: body.slice(0, 4000),
    location: res.headers.get('location') ?? '',
  };
}

export function classifyProbe(r: ProbeResponse): ProbeVerdict {
  const body = r.body.trim();
  if (r.status === 401 && body === OUR_UNAUTHORIZED) return 'ours';
  if (r.status === 500 && body === OUR_SERVER_ERROR) return 'config-error';
  if (r.status >= 300 && r.status < 400 && /vercel\.com/i.test(r.location)) return 'protected';
  if ((r.status === 401 || r.status === 403) && (/text\/html/i.test(r.contentType) || /<html/i.test(body))) {
    return 'protected';
  }
  if (r.status === 404) return 'not-found';
  return 'unexpected';
}

/** POSTs to the webhook URL without the secret header. Our function must answer 401 and do nothing. */
export async function probeWebhook(url: string, fetchImpl: typeof fetch = fetch): Promise<{ verdict: ProbeVerdict; status: number }> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    redirect: 'manual',
    signal: AbortSignal.timeout(60_000),
  });
  const r = await readProbe(res);
  return { verdict: classifyProbe(r), status: r.status };
}
