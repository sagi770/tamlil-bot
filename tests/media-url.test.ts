import { extractFirstUrl, isSafePublicHttpsUrl, normalizeMediaUrl, withoutUrls } from '../src/media-url.js';

describe('normalizeMediaUrl', () => {
  it('rewrites a Drive share link', () => {
    expect(normalizeMediaUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing')).toEqual({
      ok: true,
      source: 'drive',
      url: 'https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp&export=download&confirm=t',
    });
  });
  it('rewrites a Drive open?id= link', () => {
    expect(normalizeMediaUrl('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toEqual({
      ok: true,
      source: 'drive',
      url: 'https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp&export=download&confirm=t',
    });
  });
  it('forces dl=1 on Dropbox', () => {
    expect(normalizeMediaUrl('https://www.dropbox.com/scl/fi/abc/rec.m4a?rlkey=x&dl=0')).toEqual({
      ok: true,
      source: 'dropbox',
      url: 'https://www.dropbox.com/scl/fi/abc/rec.m4a?rlkey=x&dl=1',
    });
  });
  it('adds dl=1 on a bare Dropbox link', () => {
    expect(normalizeMediaUrl('https://dropbox.com/s/abc/rec.m4a')).toEqual({
      ok: true,
      source: 'dropbox',
      url: 'https://dropbox.com/s/abc/rec.m4a?dl=1',
    });
  });
  it('passes a direct https link through', () => {
    expect(normalizeMediaUrl('https://example.com/a.mp3')).toEqual({ ok: true, source: 'direct', url: 'https://example.com/a.mp3' });
  });
  it.each([
    ['not a url', 'invalid-url'],
    ['http://example.com/a.mp3', 'not-https'],
    ['https://127.0.0.1/a.mp3', 'blocked-host'],
    ['https://localhost/a.mp3', 'blocked-host'],
    ['https://example.com:8443/a.mp3', 'blocked-host'],
    ['https://user:pw@example.com/a.mp3', 'blocked-host'],
    ['https://intranet/a.mp3', 'blocked-host'],
    ['https://drive.google.com/drive/folders/abc', 'drive-folder'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube-unsupported'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube-unsupported'],
    ['https://m.youtube.com/', 'youtube-unsupported'],
    ['https://music.youtube.com/channel/abc', 'youtube-unsupported'],
  ])('rejects %s as %s', (raw, reason) => {
    expect(normalizeMediaUrl(raw)).toEqual({ ok: false, reason });
  });
});

describe('isSafePublicHttpsUrl', () => {
  it.each(['https://[::1]/a', 'https://printer.local/a', 'https://svc.internal/a', 'https://localhost./a'])(
    'blocks %s',
    (raw) => {
      expect(isSafePublicHttpsUrl(new URL(raw))).toBe(false);
    },
  );
  it('allows a public https host', () => {
    expect(isSafePublicHttpsUrl(new URL('https://cdn.example.com/a.mp3'))).toBe(true);
  });
});

describe('extractFirstUrl', () => {
  it('finds the first https URL in a message', () => {
    expect(extractFirstUrl('תמלל בבקשה https://example.com/a.mp3 תודה')).toBe('https://example.com/a.mp3');
    expect(extractFirstUrl('אין כאן קישור')).toBeNull();
    expect(extractFirstUrl(undefined)).toBeNull();
  });
  it('takes the first of several', () => {
    expect(extractFirstUrl('https://a.example/x https://b.example/y')).toBe('https://a.example/x');
  });
  it.each([
    ['ראה (https://example.com/a.mp3).', 'https://example.com/a.mp3'],
    ['https://example.com/a.mp3!', 'https://example.com/a.mp3'],
    ['"https://example.com/a.mp3"', 'https://example.com/a.mp3'],
    ["'https://example.com/a.mp3',", 'https://example.com/a.mp3'],
    ['https://example.com/a.mp3?', 'https://example.com/a.mp3'],
    ['https://example.com/a.mp3״', 'https://example.com/a.mp3'],
    ['https://example.com/a?x=1.', 'https://example.com/a?x=1'],
  ])('strips trailing punctuation from %s', (text, expected) => {
    expect(extractFirstUrl(text)).toBe(expected);
  });
  it('does not match http links', () => {
    expect(extractFirstUrl('http://example.com/a.mp3')).toBeNull();
  });
});

describe('withoutUrls', () => {
  it('removes every link and keeps the words around them', () => {
    expect(withoutUrls('סכם https://host.example/meeting-summary.mp3 בבקשה')?.split(/\s+/).filter(Boolean)).toEqual(['סכם', 'בבקשה']);
    expect(withoutUrls('https://a.example/summary http://b.example/tldr')?.trim()).toBe('');
    expect(withoutUrls('‎https://a.example/summary‏')?.trim()).toBe('');
    expect(withoutUrls(undefined)).toBeUndefined();
  });
});

describe('hardening', () => {
  it.each([
    ['https://localhost../a.mp3', 'blocked-host'],
    ['https://foo.local../a.mp3', 'blocked-host'],
    ['https://www.youtube.com./watch?v=dQw4w9WgXcQ', 'youtube-unsupported'],
    ['https://x.home.arpa/a', 'blocked-host'],
    ['https://foo.localhost/a', 'blocked-host'],
    ['https://[::ffff:127.0.0.1]/a', 'blocked-host'],
  ])('rejects %s as %s', (raw, reason) => {
    expect(normalizeMediaUrl(raw)).toEqual({ ok: false, reason });
  });
  it('recognizes Drive and Dropbox hosts with a trailing dot', () => {
    expect(normalizeMediaUrl('https://drive.google.com./file/d/1AbCdEfGhIjKlMnOp/view')).toMatchObject({ ok: true, source: 'drive' });
    expect(normalizeMediaUrl('https://www.dropbox.com./s/abc/rec.m4a')).toMatchObject({ ok: true, source: 'dropbox' });
    expect(normalizeMediaUrl('https://drive.google.com./drive/folders/abc')).toEqual({ ok: false, reason: 'drive-folder' });
  });
  it('strips bidi marks before matching a URL', () => {
    expect(extractFirstUrl('https://example.com/a.mp3\u200F')).toBe('https://example.com/a.mp3');
    expect(extractFirstUrl('\u202Bhttps://example.com/a.mp3\u202C תודה')).toBe('https://example.com/a.mp3');
    expect(extractFirstUrl('https://exa\u2066mple.com/a.mp3\u2069')).toBe('https://example.com/a.mp3');
    expect(extractFirstUrl('https://example.com/a.mp3\u200E!')).toBe('https://example.com/a.mp3');
  });
});
