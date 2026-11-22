export interface SonioxToken {
  text: string;
  start_ms: number;
  end_ms: number;
  confidence: number;
  speaker?: string | null;
  language?: string | null;
  is_audio_event?: boolean | null;
}

export interface SegmentDraft {
  speakerKey: string | null;
  startMs: number;
  endMs: number;
  text: string;
  language: string | null;
}

export type Mode = 't' | 's';
export type Lang = 'he' | 'en';
export type MediaUrlRejection = 'invalid-url' | 'not-https' | 'blocked-host' | 'drive-folder' | 'youtube-unsupported';
