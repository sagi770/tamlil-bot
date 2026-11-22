import { countSpeakers, formatDurationMs, formatFooter, formatTranscriptFile, formatTranscriptMessage, stripFooter } from '../src/format.js';
import { getStrings } from '../src/strings/index.js';
import type { SegmentDraft } from '../src/types.js';

const s = getStrings('he');
const seg = (speakerKey: string | null, startMs: number, text: string): SegmentDraft => ({ speakerKey, startMs, endMs: startMs + 1000, text, language: 'he' });

it('formats durations', () => {
  expect(formatDurationMs(12_000)).toBe('0:12');
  expect(formatDurationMs(750_000)).toBe('12:30');
  expect(formatDurationMs(3_725_000)).toBe('1:02:05');
  expect(formatDurationMs(null)).toBe('—');
});
it('counts distinct speakers, null included', () => {
  expect(countSpeakers([seg('1', 0, 'a'), seg('2', 1, 'b'), seg('1', 2, 'c')])).toBe(2);
  expect(countSpeakers([seg(null, 0, 'a')])).toBe(1);
});
it('message, one speaker: no labels, one line per segment', () => {
  expect(formatTranscriptMessage([seg('1', 0, 'שלום'), seg('1', 5000, 'מה נשמע')], s)).toBe('שלום\nמה נשמע');
});
it('message, several speakers: a label per run, blank line between runs', () => {
  expect(formatTranscriptMessage([seg('1', 0, 'א'), seg('1', 1000, 'ב'), seg('2', 2000, 'ג')], s)).toBe('דובר 1:\nא\nב\n\nדובר 2:\nג');
});
it('message: unknown speaker gets the fallback label', () => {
  expect(formatTranscriptMessage([seg('1', 0, 'א'), seg(null, 1000, 'ב')], s)).toBe(`דובר 1:\nא\n\n${s.unknownSpeaker}:\nב`);
});
it('file, several speakers: timestamp and label per run', () => {
  expect(formatTranscriptFile([seg('1', 0, 'א'), seg('2', 14_000, 'ב')], s)).toBe('[0:00] דובר 1:\nא\n\n[0:14] דובר 2:\nב\n');
});
it('file, one speaker: timestamp per segment', () => {
  expect(formatTranscriptFile([seg('1', 0, 'א'), seg('1', 65_000, 'ב')], s)).toBe('[0:00] א\n[1:05] ב\n');
});
it('footer', () => {
  expect(formatFooter(12_000, 1, s)).toBe('⏱ 0:12');
  expect(formatFooter(750_000, 2, s)).toBe('⏱ 12:30 · 2 דוברים');
  expect(formatFooter(null, 1, s)).toBe('⏱ —');
});
it('stripFooter removes only a trailing footer line', () => {
  expect(stripFooter('טקסט\n\n⏱ 0:12')).toBe('טקסט');
  expect(stripFooter('טקסט\n\n⏱ 12:30 · 2 דוברים')).toBe('טקסט');
  expect(stripFooter('טקסט')).toBe('טקסט');
  expect(stripFooter('⏱ בתוך משפט\nטקסט')).toBe('⏱ בתוך משפט\nטקסט');
});
