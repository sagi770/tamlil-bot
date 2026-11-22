import type { Lang, MediaUrlRejection } from '../types.js';
import { en } from './en.js';
import { he } from './he.js';

export interface Strings {
  welcome: string;
  help(hasSummary: boolean): string;
  yourId(userId: number): string;
  notAllowed(userId: number): string;
  openWarning(userId: number): string;
  transcribing: string;
  tooLarge: string;
  unsupported: string;
  noSpeech: string;
  genericError: string;
  sonioxFailed: string;
  sonioxPayment: string;
  linkRejected(reason: MediaUrlRejection): string;
  linkNotMedia: string;
  linkFetchFailed: string;
  linkJobFailed: string;
  summarizeButton: string;
  summarizing: string;
  summaryHeader: string;
  summaryFailed: string;
  summaryTruncated: string;
  messageTooOld: string;
  speaker(key: string): string;
  unknownSpeaker: string;
  speakersCount(n: number): string;
  transcriptFileName(date: Date, timeZone: string): string;
  botReady: string;
  commands: { start: string; help: string; id: string };
}

export function getStrings(lang: Lang): Strings {
  return lang === 'he' ? he : en;
}
