import { wantsSummary } from '../src/intent.js';

describe('wantsSummary', () => {
  it.each(['סיכום בבקשה', 'תסכם לי', 'סכם', 'נא לסכם', 'תקציר', 'Summarize this', 'a summary please', 'tl;dr', 'TLDR'])('detects %s', (t) => expect(wantsSummary(t)).toBe(true));
  it.each([undefined, '', 'תמלול', 'hello', 'הסכם שכירות', 'https://drive.google.com/file/d/abc'])('ignores %s', (t) => expect(wantsSummary(t)).toBe(false));
});

describe('wantsSummary Hebrew clitic prefixes', () => {
  it.each(['ולסכם', 'ותסכם', 'שתסכם', 'ותסכמו'])('detects %s', (t) => expect(wantsSummary(t)).toBe(true));
  it.each(['הסכם', 'מסכם', 'סכמה', 'הסכמים', 'סכמות', 'והסכם', 'שהסכם'])('ignores %s', (t) => expect(wantsSummary(t)).toBe(false));
});
