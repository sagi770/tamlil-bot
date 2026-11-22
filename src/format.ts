import type { Strings } from './strings/index.js';
import type { SegmentDraft } from './types.js';

export const MESSAGE_TEXT_LIMIT = 3500;

const FOOTER_RE = /\n\n⏱ [^\n]*$/;

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');

  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

export function countSpeakers(segments: SegmentDraft[]): number {
  return new Set(segments.map((seg) => seg.speakerKey)).size;
}

function speakerLabel(seg: SegmentDraft, s: Strings): string {
  return seg.speakerKey === null ? s.unknownSpeaker : s.speaker(seg.speakerKey);
}

/** A run is a maximal sequence of consecutive segments with the same speakerKey. */
function groupRuns(segments: SegmentDraft[]): SegmentDraft[][] {
  const runs: SegmentDraft[][] = [];
  for (const seg of segments) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last[0].speakerKey === seg.speakerKey) last.push(seg);
    else runs.push([seg]);
  }
  return runs;
}

export function formatTranscriptMessage(segments: SegmentDraft[], s: Strings): string {
  if (countSpeakers(segments) <= 1) return segments.map((seg) => seg.text).join('\n');
  return groupRuns(segments)
    .map((run) => [`${speakerLabel(run[0], s)}:`, ...run.map((seg) => seg.text)].join('\n'))
    .join('\n\n');
}

export function formatTranscriptFile(segments: SegmentDraft[], s: Strings): string {
  if (segments.length === 0) return '\n';
  if (countSpeakers(segments) <= 1) {
    return segments.map((seg) => `[${formatDurationMs(seg.startMs)}] ${seg.text}`).join('\n') + '\n';
  }
  const body = groupRuns(segments)
    .map((run) =>
      [`[${formatDurationMs(run[0].startMs)}] ${speakerLabel(run[0], s)}:`, ...run.map((seg) => seg.text)].join('\n'),
    )
    .join('\n\n');
  return `${body}\n`;
}

export function formatFooter(durationMs: number | null, speakers: number, s: Strings): string {
  const base = `⏱ ${formatDurationMs(durationMs)}`;
  return speakers > 1 ? `${base} · ${s.speakersCount(speakers)}` : base;
}

export function stripFooter(text: string): string {
  return text.replace(FOOTER_RE, '');
}
