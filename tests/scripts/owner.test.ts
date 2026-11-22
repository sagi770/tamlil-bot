import { findOwner, findOwnerId, parseOwnerId } from '../../scripts/lib/owner.js';
import type { TgChat, TgUpdate } from '../../src/telegram-types.js';

const start = (id: number, type: TgChat['type'] = 'private', text = '/start'): TgUpdate => ({
  update_id: id,
  message: { message_id: id, date: id, chat: { id, type }, from: { id }, text },
});

describe('findOwnerId', () => {
  it('returns the sender of the most recent private /start', () => expect(findOwnerId([start(1), start(2)])).toBe(2));
  it('ignores group chats and other texts', () =>
    expect(findOwnerId([start(1, 'group'), start(2, 'private', 'hello')])).toBeNull());
  it('returns null for no updates', () => expect(findOwnerId([])).toBeNull());

  it('picks the highest update_id even when the list is out of order', () =>
    expect(findOwnerId([start(5), start(3)])).toBe(5));

  it('accepts /start with a bot mention or a payload, but not /starter', () => {
    expect(findOwnerId([start(1, 'private', '/start@my_bot')])).toBe(1);
    expect(findOwnerId([start(2, 'private', '/start hello')])).toBe(2);
    expect(findOwnerId([start(3, 'private', '/starter')])).toBeNull();
  });
});

describe('findOwner', () => {
  it('returns the username when Telegram sent one', () => {
    const u = start(7);
    (u.message!.from as { username?: string }).username = 'dana';
    expect(findOwner([u])).toEqual({ id: 7, username: 'dana' });
    expect(findOwner([start(8)])).toEqual({ id: 8, username: null });
  });
});

describe('parseOwnerId', () => {
  it.each([
    ['1', 1],
    ['123456789', 123456789],
    ['999999999999999', 999999999999999],
  ])('accepts %s', (raw, expected) => {
    expect(parseOwnerId(raw)).toBe(expected);
  });

  it.each(['', '0', '007', '-5', '+5', '1.5', '12a', ' 12', '1234567890123456', '99999999999999999999'])(
    'rejects %j',
    (raw) => {
      expect(parseOwnerId(raw)).toBeNull();
    },
  );
});
