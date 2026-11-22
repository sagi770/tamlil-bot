import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv, restoreFileAfter, restoreFilesAfter, upsertEnv } from '../../scripts/lib/env-file.js';

describe('restoreFileAfter', () => {
  let dir: string;
  let file: string;
  const original = Buffer.from('﻿# keys\r\nTELEGRAM_BOT_TOKEN=x\r\n\r\nSONIOX_API_KEY="y"', 'utf8');
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'env-file-'));
    file = join(dir, '.env.local');
    writeFileSync(file, original);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('puts the original bytes back after fn rewrote the file', () => {
    const value = restoreFileAfter(file, () => {
      writeFileSync(file, 'VERCEL_OIDC_TOKEN=abc\n');
      return 7;
    });
    expect(value).toBe(7);
    expect(readFileSync(file).equals(original)).toBe(true);
  });

  it('also restores when fn throws, and rethrows', () => {
    expect(() =>
      restoreFileAfter(file, () => {
        writeFileSync(file, '');
        throw new Error('link failed');
      }),
    ).toThrow('link failed');
    expect(readFileSync(file).equals(original)).toBe(true);
  });
});

describe('restoreFilesAfter', () => {
  it('restores every file, also when fn throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'env-files-'));
    try {
      const a = join(dir, '.env.local');
      const b = join(dir, '.gitignore');
      const gitignore = '.env*\n!.env.example\n';
      writeFileSync(a, 'A=1\n');
      writeFileSync(b, gitignore);
      expect(() =>
        restoreFilesAfter([a, b], () => {
          writeFileSync(a, 'X=2\n');
          writeFileSync(b, `${gitignore}.vercel\n.env*\n`);
          throw new Error('link failed');
        }),
      ).toThrow('link failed');
      expect(readFileSync(a, 'utf8')).toBe('A=1\n');
      expect(readFileSync(b, 'utf8')).toBe(gitignore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parseEnv', () => {
  it('parses keys, ignoring comments and blank lines, and strips quotes', () => {
    expect(parseEnv('# c\nA=1\n\nB="two words"\n#C=3\n')).toEqual({ A: '1', B: 'two words' });
  });

  it('handles CRLF, a UTF-8 BOM, single quotes and an export prefix', () => {
    expect(parseEnv("﻿A=1\r\nexport B='x y'\r\n")).toEqual({ A: '1', B: 'x y' });
  });

  it('drops an inline comment from an unquoted value only', () => {
    expect(parseEnv('A=123 # me\nB="x # y"\nC=a#b\n')).toEqual({ A: '123', B: 'x # y', C: 'a#b' });
  });

  it('keeps an empty value and lets a later line win', () => {
    expect(parseEnv('A=\nB=1\nB=2\n')).toEqual({ A: '', B: '2' });
  });
});

describe('upsertEnv', () => {
  it('replaces an existing key in place', () => expect(upsertEnv('A=1\nB=2\n', 'A', '9')).toBe('A=9\nB=2\n'));
  it('fills a commented-out placeholder', () =>
    expect(upsertEnv('# ALLOWED_USER_IDS=\nB=2\n', 'ALLOWED_USER_IDS', '5')).toBe('ALLOWED_USER_IDS=5\nB=2\n'));
  it('appends a missing key', () => expect(upsertEnv('A=1\n', 'B', '2')).toBe('A=1\nB=2\n'));

  it('keeps CRLF line endings and every other line byte for byte', () => {
    const before = '﻿# head\r\nA=1\r\n\r\n# B=example\r\nC="q"\r\n';
    expect(upsertEnv(before, 'A', '9')).toBe('﻿# head\r\nA=9\r\n\r\n# B=example\r\nC="q"\r\n');
    expect(upsertEnv(before, 'D', '4')).toBe(`${before}D=4\r\n`);
  });

  it('does not touch a key that only shares a prefix, or a commented example with a value', () => {
    expect(upsertEnv('AB=1\n# A=example\n', 'A', '2')).toBe('AB=1\n# A=example\nA=2\n');
  });

  it('appends after a last line without a newline, and to an empty file', () => {
    expect(upsertEnv('A=1', 'B', '2')).toBe('A=1\nB=2\n');
    expect(upsertEnv('', 'B', '2')).toBe('B=2\n');
  });

  it('refuses a value with a line break', () => {
    expect(() => upsertEnv('A=1\n', 'A', 'x\ny')).toThrow();
  });
});

describe('parseEnv inline comments', () => {
  it('KEY= # comment is an empty value', () => {
    expect(parseEnv('A= # nothing yet\nB=\t#x\n')).toEqual({ A: '', B: '' });
  });

  it('a value starting with # right after = is kept (free text such as SONIOX_CONTEXT)', () => {
    expect(parseEnv('C=#y\nSONIOX_CONTEXT=#1 priority names\n')).toEqual({ C: '#y', SONIOX_CONTEXT: '#1 priority names' });
  });

  it('KEY=value # comment keeps only the value; a # inside a token (no space before) stays', () => {
    expect(parseEnv('A=value # note\nB=tok#en\n')).toEqual({ A: 'value', B: 'tok#en' });
  });

  it('upsertEnv leaves a KEY= # comment line byte-for-byte when another key changes', () => {
    const src = 'A= # keep me\r\nB=1\r\n';
    expect(upsertEnv(src, 'B', '2')).toBe('A= # keep me\r\nB=2\r\n');
  });
});
