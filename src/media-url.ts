import type { MediaUrlRejection } from './types.js';

export type NormalizedMediaUrl =
  | { ok: true; url: string; source: 'drive' | 'dropbox' | 'direct' }
  | { ok: false; reason: MediaUrlRejection };

const DRIVE_HOSTS = new Set(['drive.google.com', 'drive.usercontent.google.com']);
const DROPBOX_HOSTS = new Set(['dropbox.com', 'www.dropbox.com']);
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

/** Google Drive file ids are opaque url-safe tokens. */
const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,}$/;
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Lower-cased hostname without trailing dots ("example.com." is the same host). */
function normalizeHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.+$/, '');
}

/**
 * Host-level SSRF guard, applied to the user's URL and to every redirect hop.
 * Blocks direct private addressing only; a public DNS name that resolves to a
 * private IP is an accepted residual risk.
 */
export function isSafePublicHttpsUrl(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port !== '') return false;

  // WHATWG URL keeps IPv6 brackets in hostname.
  const hostname = normalizeHost(url);
  if (hostname.startsWith('[')) return false;
  if (IPV4_LITERAL.test(hostname)) return false;
  if (hostname === 'localhost') return false;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false;
  if (!hostname.includes('.')) return false;
  return true;
}

function extractDriveFileId(url: URL): string | null {
  if (!DRIVE_HOSTS.has(normalizeHost(url))) return null;
  const fileMatch = url.pathname.match(/^\/file\/d\/([^/]+)/);
  const candidate =
    fileMatch?.[1] ?? (['/open', '/uc', '/download'].includes(url.pathname) ? url.searchParams.get('id') : null);
  return candidate && DRIVE_FILE_ID.test(candidate) ? candidate : null;
}

function isDriveFolderUrl(url: URL): boolean {
  return DRIVE_HOSTS.has(normalizeHost(url)) && url.pathname.startsWith('/drive/folders/');
}

/** Parse, https check, host guard, then Drive / Dropbox rewrite. */
export function normalizeMediaUrl(raw: string): NormalizedMediaUrl {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }

  if (url.protocol !== 'https:') return { ok: false, reason: 'not-https' };
  if (!isSafePublicHttpsUrl(url)) return { ok: false, reason: 'blocked-host' };
  if (isDriveFolderUrl(url)) return { ok: false, reason: 'drive-folder' };

  const host = normalizeHost(url);
  if (YOUTUBE_HOSTS.has(host)) return { ok: false, reason: 'youtube-unsupported' };

  const driveId = extractDriveFileId(url);
  if (driveId) {
    return {
      ok: true,
      url: `https://drive.usercontent.google.com/download?id=${driveId}&export=download&confirm=t`,
      source: 'drive',
    };
  }

  if (DROPBOX_HOSTS.has(host)) {
    url.searchParams.set('dl', '1');
    return { ok: true, url: url.href, source: 'dropbox' };
  }

  return { ok: true, url: url.href, source: 'direct' };
}

// Invisible bidi controls that chat clients insert around pasted links.
const BIDI_MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const TRAILING_PUNCTUATION = /[.,)!?"'״]+$/;

/** First https:// URL in free text, minus punctuation that commonly trails a pasted link. */
export function extractFirstUrl(text: string | undefined): string | null {
  if (!text) return null;
  const match = text.replace(BIDI_MARKS, '').match(/https:\/\/\S+/i);
  if (!match) return null;
  const url = match[0].replace(TRAILING_PUNCTUATION, '');
  return url.length > 'https://'.length ? url : null;
}

/** The text with its links removed, so words inside a link (a file named meeting-summary.mp3) are not read as a request. */
export function withoutUrls(text: string | undefined): string | undefined {
  return text?.replace(BIDI_MARKS, '').replace(/https?:\/\/\S+/gi, ' ');
}
