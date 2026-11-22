import { decodeRef, encodeRef } from '../src/reference.js';

describe('job reference codec', () => {
  it('round-trips', () => {
    const r = { chatId: 123, replyTo: 45, statusMessageId: 46, mode: 's' as const };
    expect(encodeRef(r)).toBe('v1|123|45|46|s');
    expect(decodeRef('v1|123|45|46|s')).toEqual(r);
  });
  it('round-trips negative ids', () => {
    const r = { chatId: -100123, replyTo: 1, statusMessageId: 2, mode: 't' as const };
    expect(decodeRef(encodeRef(r))).toEqual(r);
  });
  it.each([null, undefined, '', 'v2|1|2|3|t', 'v1|x|2|3|t', 'v1|1|2|3|z', 'v1|1|2|3', 'v1|1|2|3|t|extra', 'v1|1.5|2|3|t', 'v1| 1|2|3|t', 'v1|1e3|2|3|t', 'v1|99999999999999999999|2|3|t'])('rejects %s', (raw) => expect(decodeRef(raw)).toBeNull());
});
