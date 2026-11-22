import type { Mode } from './types.js';

export interface JobRef { chatId: number; replyTo: number; statusMessageId: number; mode: Mode }

export function encodeRef(ref: JobRef): string {
  return `v1|${ref.chatId}|${ref.replyTo}|${ref.statusMessageId}|${ref.mode}`;
}

function parseInteger(raw: string): number | null {
  if (!/^-?\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

export function decodeRef(raw: string | null | undefined): JobRef | null {
  if (!raw) return null;
  const parts = raw.split('|');
  if (parts.length !== 5 || parts[0] !== 'v1') return null;
  const [, c, r, s, mode] = parts as [string, string, string, string, string];
  if (mode !== 't' && mode !== 's') return null;
  const chatId = parseInteger(c);
  const replyTo = parseInteger(r);
  const statusMessageId = parseInteger(s);
  if (chatId === null || replyTo === null || statusMessageId === null) return null;
  return { chatId, replyTo, statusMessageId, mode };
}
