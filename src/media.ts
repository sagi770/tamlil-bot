import type { TgFile, TgMessage } from './telegram-types.js';

export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export interface MediaRef { fileId: string; fileSize: number | null; fileName: string; kind: 'voice' | 'audio' | 'video' | 'video_note' | 'document' }

function toRef(file: TgFile, kind: MediaRef['kind'], defaultName: string): MediaRef {
  return { fileId: file.file_id, fileSize: file.file_size ?? null, fileName: file.file_name ?? defaultName, kind };
}

export function extractMedia(message: TgMessage): MediaRef | null {
  if (message.voice) return toRef(message.voice, 'voice', 'voice.ogg');
  if (message.audio) return toRef(message.audio, 'audio', 'audio');
  if (message.video) return toRef(message.video, 'video', 'video.mp4');
  if (message.video_note) return toRef(message.video_note, 'video_note', 'video_note.mp4');
  const doc = message.document;
  if (doc?.mime_type && (doc.mime_type.startsWith('audio/') || doc.mime_type.startsWith('video/'))) {
    return toRef(doc, 'document', 'document');
  }
  return null;
}

export function isTooLarge(ref: MediaRef): boolean {
  return ref.fileSize !== null && ref.fileSize > TELEGRAM_MAX_DOWNLOAD_BYTES;
}
