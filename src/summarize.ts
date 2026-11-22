import type { Config } from './config.js';

// gpt-6-luna: 922k max input tokens x 2 chars/token, capped at 600k (see docs/DECISIONS.md).
export const SUMMARY_MAX_INPUT_CHARS = 600_000;

// Reasoning tokens count toward this cap, so leave room for a structured summary of a long recording.
const MAX_COMPLETION_TOKENS = 8000;
const TIMEOUT_MS = 120_000;
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const SYSTEM_PROMPT = [
  'You summarize transcripts of voice recordings.',
  'Write the summary in the same language as the transcript.',
  'Use plain text only: no Markdown, so no asterisks, no hash headings and no backticks. Plain dashes for list items are fine.',
  'Structure: first the topic in one short line, then the key points, then decisions and action items, but only if the recording contains any.',
  'If there are no decisions or action items, omit that heading and section entirely: never write that there are none. The same goes for any other section that would be empty.',
  'Never invent anything that was not said in the recording.',
  'The transcript may contain speaker labels such as "דובר 1" or "Speaker 1"; refer to speakers by those labels.',
].join('\n');

export interface Summarizer {
  summarize(transcript: string): Promise<{ text: string; truncated: boolean }>;
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= SUMMARY_MAX_INPUT_CHARS) return { text, truncated: false };
  let end = SUMMARY_MAX_INPUT_CHARS;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // do not split a surrogate pair
  return { text: text.slice(0, end), truncated: true };
}

const SAFE_TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;

// Only error.code and error.param, and only when they look like identifiers: error.message can echo a key.
async function failureMessage(res: Response): Promise<string> {
  const base = `OpenAI request failed with HTTP ${res.status}`;
  try {
    const { error } = (await res.json()) as { error?: { code?: unknown; param?: unknown } };
    const parts: string[] = [];
    for (const [name, v] of [['code', error?.code], ['param', error?.param]] as const) {
      if (typeof v === 'string' && SAFE_TOKEN.test(v)) parts.push(`${name}=${v}`);
    }
    return parts.length > 0 ? `${base} (${parts.join(', ')})` : base;
  } catch {
    return base;
  }
}

export function createSummarizer(
  config: Pick<Config, 'openaiApiKey' | 'openaiModel'>,
  fetchImpl: typeof fetch = fetch,
): Summarizer | null {
  const apiKey = config.openaiApiKey;
  if (!apiKey) return null;
  return {
    async summarize(transcript) {
      const input = truncate(transcript);
      let res: Response;
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      try {
        res = await fetchImpl(ENDPOINT, {
          method: 'POST',
          signal,
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: config.openaiModel,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: input.text },
            ],
            reasoning_effort: 'low',
            max_completion_tokens: MAX_COMPLETION_TOKENS,
          }),
        });
      } catch {
        throw new Error(signal.aborted ? 'OpenAI request timed out' : 'OpenAI request failed');
      }
      if (!res.ok) throw new Error(await failureMessage(res));
      let content: unknown;
      let refusal: unknown;
      let finishReason: unknown;
      try {
        const data = (await res.json()) as {
          choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }[];
        };
        content = data.choices?.[0]?.message?.content;
        refusal = data.choices?.[0]?.message?.refusal;
        finishReason = data.choices?.[0]?.finish_reason;
      } catch {
        throw new Error('OpenAI returned an unreadable response');
      }
      if (finishReason === 'length') throw new Error('OpenAI summary was cut off');
      if (typeof refusal === 'string' && refusal) throw new Error('OpenAI refused to summarize');
      const text = typeof content === 'string' ? content.trim() : '';
      if (!text) throw new Error('OpenAI returned an empty summary');
      return { text, truncated: input.truncated };
    },
  };
}
