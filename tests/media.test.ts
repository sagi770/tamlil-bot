import { extractMedia, isTooLarge, TELEGRAM_MAX_DOWNLOAD_BYTES } from '../src/media.js';
import type { TgMessage } from '../src/telegram-types.js';

const msg = (extra: Partial<TgMessage>): TgMessage => ({ message_id: 1, date: 1, chat: { id: 5, type: 'private' }, from: { id: 5 }, ...extra });

describe('extractMedia', () => {
  it('extracts a voice message', () => expect(extractMedia(msg({ voice: { file_id: 'f', file_size: 100 } }))).toEqual({ fileId: 'f', fileSize: 100, fileName: 'voice.ogg', kind: 'voice' }));
  it('extracts audio with its own file name', () => expect(extractMedia(msg({ audio: { file_id: 'f', file_name: 'a.mp3' } }))).toEqual({ fileId: 'f', fileSize: null, fileName: 'a.mp3', kind: 'audio' }));
  it('extracts video and video_note', () => {
    expect(extractMedia(msg({ video: { file_id: 'f' } }))?.kind).toBe('video');
    expect(extractMedia(msg({ video_note: { file_id: 'f' } }))?.kind).toBe('video_note');
  });
  it('accepts an audio or video document', () => {
    expect(extractMedia(msg({ document: { file_id: 'f', mime_type: 'audio/mpeg' } }))?.kind).toBe('document');
    expect(extractMedia(msg({ document: { file_id: 'f', mime_type: 'video/mp4' } }))?.kind).toBe('document');
  });
  it('rejects other documents and plain text', () => {
    expect(extractMedia(msg({ document: { file_id: 'f', mime_type: 'application/pdf' } }))).toBeNull();
    expect(extractMedia(msg({ text: 'hi' }))).toBeNull();
  });
  it('rejects a document without a mime type', () => {
    expect(extractMedia(msg({ document: { file_id: 'f' } }))).toBeNull();
  });
  it('prefers voice, audio, video, video_note, document in that order', () => {
    const all = { voice: { file_id: 'v' }, audio: { file_id: 'a' }, video: { file_id: 'vi' }, video_note: { file_id: 'vn' }, document: { file_id: 'd', mime_type: 'audio/mpeg' } };
    expect(extractMedia(msg(all))?.fileId).toBe('v');
    expect(extractMedia(msg({ ...all, voice: undefined }))?.fileId).toBe('a');
    expect(extractMedia(msg({ ...all, voice: undefined, audio: undefined }))?.fileId).toBe('vi');
    expect(extractMedia(msg({ ...all, voice: undefined, audio: undefined, video: undefined }))?.fileId).toBe('vn');
  });
});

describe('isTooLarge', () => {
  it('is too large only above the limit, and never when the size is unknown', () => {
    const ref = (fileSize: number | null) => ({ fileId: 'f', fileSize, fileName: 'x', kind: 'audio' as const });
    expect(isTooLarge(ref(TELEGRAM_MAX_DOWNLOAD_BYTES))).toBe(false);
    expect(isTooLarge(ref(TELEGRAM_MAX_DOWNLOAD_BYTES + 1))).toBe(true);
    expect(isTooLarge(ref(null))).toBe(false);
  });
});
