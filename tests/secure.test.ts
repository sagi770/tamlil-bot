import { safeEqual } from '../src/secure.js';

it('accepts equal strings', () => expect(safeEqual('abc', 'abc')).toBe(true));
it('rejects different strings of equal length', () => expect(safeEqual('abc', 'abd')).toBe(false));
it('rejects different lengths', () => expect(safeEqual('abc', 'abcd')).toBe(false));
it('rejects empty against non-empty', () => expect(safeEqual('', 'a')).toBe(false));
