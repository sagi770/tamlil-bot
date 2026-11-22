import type { SonioxToken, SegmentDraft } from "./types.js";

/**
 * Pure token → segment grouping, ported from Tamlil's segment grouping. No I/O, no env.
 *
 * A new segment begins when:
 *   1. the speaker changes (a null↔real-speaker transition counts as a change),
 *   2. the silence gap to the next token exceeds `maxGapMs`, or
 *   3. the segment span would exceed `maxSegmentMs` — preferring to break just
 *      after a recent sentence-ending punctuation mark when one exists.
 *
 * Junk tokens are dropped first: audio-event markers, empty/whitespace-only
 * text, and control markers like `<end>`.
 */

const DEFAULT_MAX_GAP_MS = 2000;
const DEFAULT_MAX_SEGMENT_MS = 45000;

/**
 * "Recently" for rule 3: a sentence-ending punctuation is only a preferred
 * break point if it occurred within this window of the overflowing token's end.
 * Chosen at ~15s so a stale full-stop near the start of a run-on monologue does
 * not drag the break far back; a fresh sentence boundary wins instead.
 */
const RECENT_PUNCT_WINDOW_MS = 15000;

/** Sentence-ending marks: period, question, exclamation, Hebrew sof pasuq (U+05C3). */
const SENTENCE_END_RE = /[.?!׃]$/;

/** Control/marker tokens Soniox may emit, e.g. `<end>`. */
const MARKER_RE = /^<[^>]*>$/;

function normalizeSpeaker(speaker: string | null | undefined): string | null {
  return speaker ?? null;
}

function keepToken(t: SonioxToken): boolean {
  if (t.is_audio_event === true) return false;
  const trimmed = t.text.trim();
  if (trimmed.length === 0) return false;
  if (MARKER_RE.test(trimmed)) return false;
  return true;
}

function endsSentence(text: string): boolean {
  return SENTENCE_END_RE.test(text.trimEnd());
}

/** Majority language of a token run; ties → first seen; null votes ignored. */
function majorityLanguage(tokens: SonioxToken[]): string | null {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  tokens.forEach((t, i) => {
    const lang = t.language ?? null;
    if (lang === null) return;
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
    if (!firstSeen.has(lang)) firstSeen.set(lang, i);
  });

  let best: string | null = null;
  let bestCount = 0;
  let bestFirst = Number.POSITIVE_INFINITY;
  for (const [lang, count] of counts) {
    const first = firstSeen.get(lang) ?? 0;
    if (count > bestCount || (count === bestCount && first < bestFirst)) {
      best = lang;
      bestCount = count;
      bestFirst = first;
    }
  }
  return best;
}

function toDraft(tokens: SonioxToken[]): SegmentDraft {
  return {
    speakerKey: normalizeSpeaker(tokens[0].speaker),
    startMs: tokens[0].start_ms,
    endMs: tokens[tokens.length - 1].end_ms,
    text: tokens.map((t) => t.text).join("").trim(),
    language: majorityLanguage(tokens),
  };
}

export function groupTokensIntoSegments(
  tokens: SonioxToken[],
  opts?: { maxGapMs?: number; maxSegmentMs?: number },
): SegmentDraft[] {
  const maxGapMs = opts?.maxGapMs ?? DEFAULT_MAX_GAP_MS;
  const maxSegmentMs = opts?.maxSegmentMs ?? DEFAULT_MAX_SEGMENT_MS;

  const kept = tokens.filter(keepToken);
  if (kept.length === 0) return [];

  const segments: SegmentDraft[] = [];
  let current: SonioxToken[] = [];

  /** Index within `current` of the most recent sentence-ending token, or -1. */
  let lastPunctIdx = -1;

  const recomputeLastPunct = (): void => {
    lastPunctIdx = -1;
    for (let i = 0; i < current.length; i++) {
      if (endsSentence(current[i].text)) lastPunctIdx = i;
    }
  };

  for (const t of kept) {
    if (current.length === 0) {
      current.push(t);
      lastPunctIdx = endsSentence(t.text) ? 0 : -1;
      continue;
    }

    const prev = current[current.length - 1];
    const speakerChanged =
      normalizeSpeaker(t.speaker) !== normalizeSpeaker(prev.speaker);
    const gapTooBig = t.start_ms - prev.end_ms > maxGapMs;

    if (speakerChanged || gapTooBig) {
      segments.push(toDraft(current));
      current = [t];
      lastPunctIdx = endsSentence(t.text) ? 0 : -1;
      continue;
    }

    const spanWithT = t.end_ms - current[0].start_ms;
    if (spanWithT > maxSegmentMs) {
      const punctRecent =
        lastPunctIdx >= 0 &&
        lastPunctIdx < current.length - 1 && // a real split point remains after it
        t.end_ms - current[lastPunctIdx].end_ms <= RECENT_PUNCT_WINDOW_MS;

      if (punctRecent) {
        // Break just after the recent sentence boundary; carry the tail forward.
        const head = current.slice(0, lastPunctIdx + 1);
        const tail = current.slice(lastPunctIdx + 1);
        segments.push(toDraft(head));
        current = [...tail, t];
        recomputeLastPunct();
      } else {
        // No usable recent boundary — break at the length limit, before `t`.
        segments.push(toDraft(current));
        current = [t];
        lastPunctIdx = endsSentence(t.text) ? 0 : -1;
      }
      continue;
    }

    current.push(t);
    if (endsSentence(t.text)) lastPunctIdx = current.length - 1;
  }

  if (current.length > 0) segments.push(toDraft(current));
  return segments;
}
