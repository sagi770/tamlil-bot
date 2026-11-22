import type { TgUpdate } from '../../src/telegram-types.js';

const START = /^\/start(?:@\w+)?(?:\s|$)/;

/** The sender of the most recent /start in a private chat, with the @username when Telegram sent one. */
export function findOwner(updates: TgUpdate[]): { id: number; username: string | null } | null {
  let best: { updateId: number; id: number; username: string | null } | null = null;
  for (const u of updates) {
    const m = u.message;
    if (!m || m.chat.type !== 'private' || !m.from || !START.test(m.text ?? '')) continue;
    if (best && u.update_id < best.updateId) continue;
    const username = (m.from as { username?: unknown }).username;
    best = { updateId: u.update_id, id: m.from.id, username: typeof username === 'string' ? username : null };
  }
  return best ? { id: best.id, username: best.username } : null;
}

/** A Telegram user id from --owner-id: 1-15 digits, no leading zero, so always a positive safe integer. */
export function parseOwnerId(raw: string): number | null {
  return /^[1-9][0-9]{0,14}$/.test(raw) ? Number(raw) : null;
}

export function findOwnerId(updates: TgUpdate[]): number | null {
  return findOwner(updates)?.id ?? null;
}
