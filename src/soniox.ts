import { SonioxNodeClient, isSonioxHttpError } from '@soniox/node';
import type { CreateTranscriptionOptions } from '@soniox/node';
import type { Config } from './config.js';
import { safeEqual } from './secure.js';
import type { SonioxToken } from './types.js';

export const SONIOX_WEBHOOK_HEADER = 'x-tamlil-bot-secret';
export const SONIOX_WEBHOOK_PATH = '/api/soniox';

export interface SonioxJob {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  durationMs: number | null;
  ref: string | null;
  isLink: boolean;
}

export type SonioxStartErrorKind = 'payment' | 'other';

const START_ERROR_MESSAGES: Record<SonioxStartErrorKind, string> = {
  payment: 'Soniox rejected the request: payment required',
  other: 'Soniox could not start the transcription',
};

/** Never carries the request, the audio URL or the SDK error text. */
export class SonioxStartError extends Error {
  readonly kind: SonioxStartErrorKind;
  /** HTTP status when known; safe to log. */
  readonly status: number | null;
  constructor(kind: SonioxStartErrorKind, status: number | null = null) {
    super(START_ERROR_MESSAGES[kind]);
    this.name = 'SonioxStartError';
    this.kind = kind;
    this.status = status;
  }
}

/**
 * webhookBase: the https origin Telegram called for this update (see createTelegramHandler).
 * The webhook goes to PUBLIC_BASE_URL if set, else to webhookBase, else to
 * VERCEL_PROJECT_PRODUCTION_URL, and only when the webhook secret is set.
 */
export interface SonioxGateway {
  startFromFile(input: { stream: ReadableStream<Uint8Array>; filename: string; ref: string; webhookBase?: string }): Promise<{ id: string }>;
  startFromUrl(input: { url: string; ref: string; webhookBase?: string }): Promise<{ id: string }>;
  getJob(id: string): Promise<SonioxJob | null>;
  getTokens(id: string): Promise<SonioxToken[]>;
  destroy(id: string): Promise<void>;
  countLeftovers(): Promise<{ transcriptions: number; files: number }>;
}

function statusOf(err: unknown): number | undefined {
  if (isSonioxHttpError(err)) return err.statusCode;
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const code = (err as { statusCode: unknown }).statusCode;
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
}

// HTTP 402 is Soniox's documented answer for an exhausted balance or monthly budget
// (docs/DECISIONS.md, "README facts verified": Soniox out of credit).
function toStartError(err: unknown): SonioxStartError {
  const status = statusOf(err) ?? null;
  return new SonioxStartError(status === 402 ? 'payment' : 'other', status);
}

async function countAll(list: AsyncIterable<unknown>): Promise<number> {
  let n = 0;
  for await (const item of list) {
    void item;
    n++;
  }
  return n;
}

export function createSonioxGateway(config: Config, client?: SonioxNodeClient): SonioxGateway {
  let cached = client;
  const sdk = (): SonioxNodeClient => (cached ??= new SonioxNodeClient({ api_key: config.sonioxApiKey }));

  function webhookBaseFor(requestBase: string | undefined): string | null {
    if (config.publicBaseUrlIsExplicit) return config.publicBaseUrl;
    return requestBase ?? config.publicBaseUrl;
  }

  function createOptions(
    source: Pick<CreateTranscriptionOptions, 'file_id' | 'audio_url'>,
    ref: string,
    requestBase: string | undefined,
  ): CreateTranscriptionOptions {
    const options: CreateTranscriptionOptions = {
      model: config.sonioxModel,
      ...source,
      language_hints: config.languageHints,
      enable_speaker_diarization: true,
      enable_language_identification: true,
      client_reference_id: ref,
    };
    if (config.sonioxContext) options.context = { text: config.sonioxContext };
    const base = webhookBaseFor(requestBase);
    if (base && config.sonioxWebhookSecret) {
      options.webhook_url = `${base}${SONIOX_WEBHOOK_PATH}`;
      options.webhook_auth_header_name = SONIOX_WEBHOOK_HEADER;
      options.webhook_auth_header_value = config.sonioxWebhookSecret;
    }
    return options;
  }

  return {
    async startFromFile({ stream, filename, ref, webhookBase }) {
      let fileId: string;
      try {
        fileId = (await sdk().files.upload(stream, { filename })).id;
      } catch (err) {
        throw toStartError(err);
      }
      try {
        const job = await sdk().stt.create(createOptions({ file_id: fileId }, ref, webhookBase));
        return { id: job.id };
      } catch (err) {
        await sdk().files.delete(fileId).catch(() => undefined);
        throw toStartError(err);
      }
    },

    async startFromUrl({ url, ref, webhookBase }) {
      try {
        const job = await sdk().stt.create(createOptions({ audio_url: url }, ref, webhookBase));
        return { id: job.id };
      } catch (err) {
        throw toStartError(err);
      }
    },

    async getJob(id) {
      const job = await sdk().stt.get(id);
      if (!job) return null;
      return {
        id: job.id,
        status: job.status,
        durationMs: job.audio_duration_ms ?? null,
        ref: job.client_reference_id ?? null,
        isLink: typeof job.audio_url === 'string' && job.audio_url.length > 0,
      };
    },

    async getTokens(id) {
      const transcript = await sdk().stt.getTranscript(id);
      if (!transcript) throw new Error('Soniox transcript is not available');
      return transcript.tokens.map((t) => ({
        text: t.text,
        start_ms: t.start_ms ?? 0,
        end_ms: t.end_ms ?? 0,
        confidence: t.confidence,
        speaker: t.speaker ?? null,
        language: t.language ?? null,
        is_audio_event: t.is_audio_event ?? null,
      }));
    },

    async destroy(id) {
      try {
        await sdk().stt.destroy(id);
      } catch (err) {
        const status = statusOf(err);
        // 404: already gone. 409: still running; a later cleanup removes it.
        if (status === 404 || status === 409) return;
        throw err;
      }
    },

    async countLeftovers() {
      const [transcriptions, files] = await Promise.all([countAll(await sdk().stt.list()), countAll(await sdk().files.list())]);
      return { transcriptions, files };
    },
  };
}

export async function verifySonioxWebhook(
  request: Request,
  secret: string,
): Promise<{ ok: true; id: string; status: 'completed' | 'error' } | { ok: false }> {
  try {
    const header = request.headers.get(SONIOX_WEBHOOK_HEADER);
    if (!secret || !header || !safeEqual(header, secret)) return { ok: false };
    const body: unknown = JSON.parse(await request.text());
    if (typeof body !== 'object' || body === null) return { ok: false };
    const { id, status } = body as Record<string, unknown>;
    if (typeof id !== 'string' || id.length === 0) return { ok: false };
    if (status !== 'completed' && status !== 'error') return { ok: false };
    return { ok: true, id, status };
  } catch {
    return { ok: false };
  }
}
