import { groupTokensIntoSegments } from "../src/segments.js";
import type { SonioxToken, SegmentDraft } from "../src/types.js";

/** Minimal token factory — fills in the fields a case doesn't care about. */
function tok(partial: Partial<SonioxToken> & Pick<SonioxToken, "text">): SonioxToken {
  return {
    start_ms: 0,
    end_ms: 0,
    confidence: 1,
    ...partial,
  };
}

describe("groupTokensIntoSegments", () => {
  // (f) empty input
  it("returns [] for empty input", () => {
    expect(groupTokensIntoSegments([])).toEqual([]);
  });

  it("returns [] when every token is dropped", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "   ", start_ms: 0, end_ms: 100, speaker: "1" }),
      tok({ text: "<end>", start_ms: 100, end_ms: 200, speaker: "1" }),
      tok({ text: "boom", start_ms: 200, end_ms: 300, speaker: "1", is_audio_event: true }),
    ];
    expect(groupTokensIntoSegments(tokens)).toEqual([]);
  });

  // (a) single speaker → one segment
  it("groups a single speaker's tokens into one segment", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "שלום", start_ms: 0, end_ms: 500, speaker: "1", language: "he" }),
      tok({ text: " עולם", start_ms: 500, end_ms: 1000, speaker: "1", language: "he" }),
      tok({ text: " כאן", start_ms: 1000, end_ms: 1500, speaker: "1", language: "he" }),
    ];
    const segs = groupTokensIntoSegments(tokens);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual<SegmentDraft>({
      speakerKey: "1",
      startMs: 0,
      endMs: 1500,
      text: "שלום עולם כאן",
      language: "he",
    });
  });

  // (b) alternating speakers → split on speaker change
  it("splits when the speaker changes", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "שלום", start_ms: 0, end_ms: 500, speaker: "1", language: "he" }),
      tok({ text: " עולם", start_ms: 500, end_ms: 1000, speaker: "1", language: "he" }),
      tok({ text: "מה", start_ms: 1000, end_ms: 1500, speaker: "2", language: "he" }),
      tok({ text: " שלומך", start_ms: 1500, end_ms: 2000, speaker: "2", language: "he" }),
    ];
    const segs = groupTokensIntoSegments(tokens);
    expect(segs).toHaveLength(2);
    expect(segs[0].speakerKey).toBe("1");
    expect(segs[0].text).toBe("שלום עולם");
    expect(segs[1].speakerKey).toBe("2");
    expect(segs[1].text).toBe("מה שלומך");
  });

  // (c) silence gap → split within the same speaker
  it("splits on a silence gap larger than maxGapMs within one speaker", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "חלק", start_ms: 0, end_ms: 500, speaker: "1", language: "he" }),
      tok({ text: " ראשון", start_ms: 500, end_ms: 1000, speaker: "1", language: "he" }),
      // gap = 4000 - 1000 = 3000 > 2000 default → split
      tok({ text: "חלק", start_ms: 4000, end_ms: 4500, speaker: "1", language: "he" }),
      tok({ text: " שני", start_ms: 4500, end_ms: 5000, speaker: "1", language: "he" }),
    ];
    const segs = groupTokensIntoSegments(tokens);
    expect(segs).toHaveLength(2);
    expect(segs[0].text).toBe("חלק ראשון");
    expect(segs[0].endMs).toBe(1000);
    expect(segs[1].text).toBe("חלק שני");
    expect(segs[1].startMs).toBe(4000);
    // both same speaker
    expect(segs[0].speakerKey).toBe("1");
    expect(segs[1].speakerKey).toBe("1");
  });

  it("does NOT split on a gap exactly equal to maxGapMs (strictly greater)", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "a", start_ms: 0, end_ms: 1000, speaker: "1" }),
      // gap = 3000 - 1000 = 2000, not > 2000 → same segment
      tok({ text: " b", start_ms: 3000, end_ms: 4000, speaker: "1" }),
    ];
    expect(groupTokensIntoSegments(tokens)).toHaveLength(1);
  });

  it("does not split on overlapping tokens (negative gap)", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "a", start_ms: 0, end_ms: 1000, speaker: "1" }),
      tok({ text: " b", start_ms: 900, end_ms: 1500, speaker: "1" }),
    ];
    expect(groupTokensIntoSegments(tokens)).toHaveLength(1);
  });

  // (d) long monologue → split at maxSegmentMs, preferring a recent sentence break
  it("splits a long monologue after a recent sentence-ending punctuation", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "שלום", start_ms: 0, end_ms: 2000, speaker: "1", language: "he" }),
      tok({ text: " עולם.", start_ms: 2000, end_ms: 4000, speaker: "1", language: "he" }),
      tok({ text: " מה", start_ms: 4000, end_ms: 6000, speaker: "1", language: "he" }),
      // adding this makes span = 11000 - 0 = 11000 > 10000; last punct ended at 4000 (recent) → break after it
      tok({ text: " שלומך", start_ms: 6000, end_ms: 11000, speaker: "1", language: "he" }),
    ];
    const segs = groupTokensIntoSegments(tokens, { maxSegmentMs: 10000, maxGapMs: 100000 });
    expect(segs).toHaveLength(2);
    expect(segs[0].text).toBe("שלום עולם.");
    expect(segs[0].endMs).toBe(4000);
    expect(segs[1].text).toBe("מה שלומך");
    expect(segs[1].startMs).toBe(4000);
  });

  it("splits a long run-on at the length limit when the only punctuation is stale (not recent)", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "בראשית.", start_ms: 0, end_ms: 1000, speaker: "1", language: "he" }),
      tok({ text: " אחת", start_ms: 1000, end_ms: 6000, speaker: "1", language: "he" }),
      tok({ text: " שתיים", start_ms: 6000, end_ms: 11000, speaker: "1", language: "he" }),
      tok({ text: " שלוש", start_ms: 11000, end_ms: 16000, speaker: "1", language: "he" }),
      tok({ text: " ארבע", start_ms: 16000, end_ms: 21000, speaker: "1", language: "he" }),
      tok({ text: " חמש", start_ms: 21000, end_ms: 26000, speaker: "1", language: "he" }),
      tok({ text: " שש", start_ms: 26000, end_ms: 31000, speaker: "1", language: "he" }),
      tok({ text: " שבע", start_ms: 31000, end_ms: 36000, speaker: "1", language: "he" }),
      tok({ text: " שמונה", start_ms: 36000, end_ms: 41000, speaker: "1", language: "he" }),
      // span at this token = 46000 - 0 = 46000 > 45000; only punct is at 1000 (stale) → break BEFORE this token
      tok({ text: " תשע", start_ms: 41000, end_ms: 46000, speaker: "1", language: "he" }),
      tok({ text: " עשר.", start_ms: 46000, end_ms: 48000, speaker: "1", language: "he" }),
    ];
    const segs = groupTokensIntoSegments(tokens);
    expect(segs).toHaveLength(2);
    // first segment keeps the stale period at its head and runs to the length limit
    expect(segs[0].text.startsWith("בראשית.")).toBe(true);
    expect(segs[0].text.endsWith("שמונה")).toBe(true);
    expect(segs[0].endMs).toBe(41000);
    expect(segs[1].text).toBe("תשע עשר.");
    expect(segs[1].startMs).toBe(41000);
  });

  it("keeps a single token whose own span exceeds maxSegmentMs as one segment", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "אאא", start_ms: 0, end_ms: 60000, speaker: "1", language: "he" }),
    ];
    const segs = groupTokensIntoSegments(tokens);
    expect(segs).toHaveLength(1);
    expect(segs[0].endMs).toBe(60000);
  });

  // (e) null / undefined speaker handling
  it("groups null/undefined-speaker tokens together with speakerKey null", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "אחד", start_ms: 0, end_ms: 500, language: "he" }),
      tok({ text: " שתיים", start_ms: 500, end_ms: 1000, speaker: null, language: "he" }),
    ];
    const segs = groupTokensIntoSegments(tokens);
    expect(segs).toHaveLength(1);
    expect(segs[0].speakerKey).toBeNull();
    expect(segs[0].text).toBe("אחד שתיים");
  });

  it("treats a null↔real-speaker transition as a speaker change", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "בלי", start_ms: 0, end_ms: 500, speaker: null }),
      tok({ text: " דובר", start_ms: 500, end_ms: 1000, speaker: null }),
      tok({ text: "עם", start_ms: 1000, end_ms: 1500, speaker: "1" }),
    ];
    const segs = groupTokensIntoSegments(tokens);
    expect(segs).toHaveLength(2);
    expect(segs[0].speakerKey).toBeNull();
    expect(segs[1].speakerKey).toBe("1");
  });

  // (g) whitespace concat + dropping junk tokens
  it("concatenates token whitespace as-is, trims the segment, and drops junk tokens", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "  שלום", start_ms: 0, end_ms: 500, speaker: "1", language: "he" }),
      tok({ text: "   ", start_ms: 500, end_ms: 600, speaker: "1", language: "he" }), // whitespace-only → dropped
      tok({ text: " עולם", start_ms: 600, end_ms: 1000, speaker: "1", language: "he" }),
      tok({ text: "<end>", start_ms: 1000, end_ms: 1100, speaker: "1" }), // marker → dropped
      tok({ text: "noise", start_ms: 1100, end_ms: 1200, speaker: "1", is_audio_event: true }), // event → dropped
      tok({ text: " !", start_ms: 1200, end_ms: 1400, speaker: "1", language: "he" }),
    ];
    const segs = groupTokensIntoSegments(tokens);
    expect(segs).toHaveLength(1);
    // leading spaces trimmed, internal spacing preserved as authored by the kept tokens
    expect(segs[0].text).toBe("שלום עולם !");
    expect(segs[0].startMs).toBe(0);
    expect(segs[0].endMs).toBe(1400); // end of last KEPT token
  });

  // language voting
  it("picks the majority language of the segment", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "a", start_ms: 0, end_ms: 100, speaker: "1", language: "he" }),
      tok({ text: " b", start_ms: 100, end_ms: 200, speaker: "1", language: "en" }),
      tok({ text: " c", start_ms: 200, end_ms: 300, speaker: "1", language: "he" }),
    ];
    expect(groupTokensIntoSegments(tokens)[0].language).toBe("he");
  });

  it("breaks a language tie in favor of the first seen", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "a", start_ms: 0, end_ms: 100, speaker: "1", language: "en" }),
      tok({ text: " b", start_ms: 100, end_ms: 200, speaker: "1", language: "he" }),
    ];
    expect(groupTokensIntoSegments(tokens)[0].language).toBe("en");
  });

  it("ignores null/undefined languages when voting", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "a", start_ms: 0, end_ms: 100, speaker: "1", language: null }),
      tok({ text: " b", start_ms: 100, end_ms: 200, speaker: "1" }),
      tok({ text: " c", start_ms: 200, end_ms: 300, speaker: "1", language: "en" }),
    ];
    expect(groupTokensIntoSegments(tokens)[0].language).toBe("en");
  });

  it("yields language null when no token carries a language", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "a", start_ms: 0, end_ms: 100, speaker: "1" }),
      tok({ text: " b", start_ms: 100, end_ms: 200, speaker: "1", language: null }),
    ];
    expect(groupTokensIntoSegments(tokens)[0].language).toBeNull();
  });

  // custom opts
  it("honors a custom maxGapMs", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "a", start_ms: 0, end_ms: 1000, speaker: "1" }),
      tok({ text: " b", start_ms: 1600, end_ms: 2000, speaker: "1" }), // gap 600
    ];
    // default keeps together; a tiny maxGapMs splits
    expect(groupTokensIntoSegments(tokens)).toHaveLength(1);
    expect(groupTokensIntoSegments(tokens, { maxGapMs: 500 })).toHaveLength(2);
  });

  it("splits on the Hebrew sof-pasuq punctuation mark", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "פסוק", start_ms: 0, end_ms: 2000, speaker: "1", language: "he" }),
      tok({ text: " ראשון׃", start_ms: 2000, end_ms: 4000, speaker: "1", language: "he" }),
      tok({ text: " המשך", start_ms: 4000, end_ms: 6000, speaker: "1", language: "he" }),
      tok({ text: " ארוך", start_ms: 6000, end_ms: 11000, speaker: "1", language: "he" }),
    ];
    const segs = groupTokensIntoSegments(tokens, { maxSegmentMs: 10000, maxGapMs: 100000 });
    expect(segs).toHaveLength(2);
    expect(segs[0].text).toBe("פסוק ראשון׃");
    expect(segs[1].text).toBe("המשך ארוך");
  });

  it("does not mutate the input tokens array", () => {
    const tokens: SonioxToken[] = [
      tok({ text: "a", start_ms: 0, end_ms: 100, speaker: "1" }),
      tok({ text: "   ", start_ms: 100, end_ms: 200, speaker: "1" }),
    ];
    const before = JSON.stringify(tokens);
    groupTokensIntoSegments(tokens);
    expect(JSON.stringify(tokens)).toBe(before);
  });
});
