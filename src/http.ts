import { ConfigError } from './config.js';
import type { Deps } from './deliver.js';
import { handleSonioxEvent } from './handle-soniox.js';
import type { SonioxEventResult } from './handle-soniox.js';
import { handleUpdate } from './handle-update.js';
import { logger } from './log.js';
import { safeEqual } from './secure.js';
import { verifySonioxWebhook } from './soniox.js';
import type { TgUpdate } from './telegram-types.js';

export type WaitUntil = (promise: Promise<unknown>) => void;
type Handler = (request: Request) => Promise<Response>;

export const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

const methodNotAllowed = () =>
  new Response('method not allowed', { status: 405, headers: { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' } });

/** Missing variable names are not secrets and go to the log only; the body stays generic. */
function loadDeps(getDeps: () => Deps): Deps | Response {
  try {
    return getDeps();
  } catch (e) {
    if (e instanceof ConfigError) logger.error('config_error', { missing: e.missing.join(',') });
    else logger.error('deps_failed', { error: e instanceof Error ? e.constructor.name : typeof e });
    return text('server error', 500);
  }
}

function isUpdate(body: unknown): body is TgUpdate {
  return (
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    typeof (body as { update_id?: unknown }).update_id === 'number'
  );
}

export function createTelegramHandler(getDeps: () => Deps, waitUntil: WaitUntil): Handler {
  return async (request) => {
    if (request.method !== 'POST') return methodNotAllowed();
    const deps = loadDeps(getDeps);
    if (deps instanceof Response) return deps;

    const header = request.headers.get(TELEGRAM_SECRET_HEADER);
    const secret = deps.config.telegramWebhookSecret;
    if (!secret || !header || !safeEqual(header, secret)) return text('unauthorized', 401);

    let body: unknown;
    try {
      body = JSON.parse(await request.text());
    } catch {
      return text('bad request', 400);
    }
    if (!isUpdate(body)) return text('bad request', 400);

    waitUntil(handleUpdate(deps, body, { webhookBase: httpsOrigin(request.url) }));
    return text('ok', 200);
  };
}

/**
 * The origin of the authenticated Telegram request, i.e. the host setup registered with Telegram.
 * Soniox's webhook goes there (unless PUBLIC_BASE_URL is set), so both always use the same host.
 * Only https is accepted: the webhook carries the secret header.
 */
function httpsOrigin(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

export function createSonioxHandler(getDeps: () => Deps, waitUntil: WaitUntil): Handler {
  return async (request) => {
    if (request.method !== 'POST') return methodNotAllowed();
    const deps = loadDeps(getDeps);
    if (deps instanceof Response) return deps;

    const verified = await verifySonioxWebhook(request, deps.config.sonioxWebhookSecret);
    if (!verified.ok) return text('unauthorized', 401);

    let result: SonioxEventResult;
    try {
      result = await handleSonioxEvent(deps, { id: verified.id, status: verified.status });
    } catch (e) {
      // Class name only: the message may carry transcript text or request details.
      deps.log.error('soniox_event_failed', { error: e instanceof Error ? e.constructor.name : typeof e });
      return text('error', 500);
    }
    if (result.background) waitUntil(result.background);
    return result.status === 200 ? text('ok', 200) : text('error', 500);
  };
}
