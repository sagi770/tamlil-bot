// Matched anywhere in the text.
const SUBSTRINGS = ['סיכום', 'תקציר', 'summar', 'tldr', 'tl;dr'];
// Matched only as whole tokens, so that e.g. "הסכם" (agreement) does not trigger.
const WHOLE_WORDS = new Set(['סכם', 'סכמי', 'סכמו', 'תסכם', 'תסכמי', 'תסכמו', 'לסכם']);

// JavaScript's \b is ASCII-only and useless for Hebrew, so tokenize on non-letter/number runs.
export function wantsSummary(text: string | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (SUBSTRINGS.some((s) => lower.includes(s))) return true;
  // A single leading ו ("and") or ש ("that") is a clitic: ולסכם, ותסכם, שתסכם.
  return lower.split(/[^\p{L}\p{N}]+/u).some((token) => WHOLE_WORDS.has(token) || WHOLE_WORDS.has(token.replace(/^[וש]/u, '')));
}
