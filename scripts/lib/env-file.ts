import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const ENV_FILE = '.env.local';

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

function unquote(raw: string): string {
  const v = raw.trim();
  // Whitespace after = followed by # starts a comment: "A= # later" is empty. "A=#1 names" (no
  // space) keeps its value, since free-text values such as SONIOX_CONTEXT may start with #.
  if (/^\s+#/.test(raw)) return '';
  const q = v[0];
  if ((q === '"' || q === "'") && v.length >= 2) {
    const end = v.indexOf(q, 1);
    if (end > 0) return v.slice(1, end);
  }
  // Unquoted: whitespace followed by # starts a comment ("A=123 # me" is "123"); a # inside a
  // token ("A=a#b") is part of the value.
  return v.replace(/\s+#.*$/, '').trim();
}

/** Reads dotenv text. Comments, blank lines and a leading BOM are ignored; a later line wins. */
export function parseEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.replace(/^﻿/, '').split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const m = ASSIGNMENT.exec(line);
    if (m) env[m[1]] = unquote(m[2]);
  }
  return env;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Sets KEY=value. Replaces the key's assignment lines in place, else fills an empty
 * commented-out placeholder ("# KEY="), else appends. Every other byte is kept, including
 * CRLF line endings. The value is written unquoted, so it must not contain a line break.
 */
export function upsertEnv(content: string, key: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new Error(`The value for ${key} contains a line break`);
  const assignment = new RegExp(`^\\s*(?:export\\s+)?${escapeRe(key)}\\s*=`);
  const placeholder = new RegExp(`^\\s*#\\s*${escapeRe(key)}\\s*=\\s*$`);
  const lines = content.split('\n');
  const body = (line: string) => line.replace(/\r$/, '');
  const withCr = (line: string, text: string) => (line.endsWith('\r') ? `${text}\r` : text);
  const entry = `${key}=${value}`;

  let found = false;
  const replaced = lines.map((line) => {
    if (!assignment.test(body(line).replace(/^﻿/, ''))) return line;
    found = true;
    const bom = line.startsWith('﻿') ? '﻿' : '';
    return withCr(line, `${bom}${entry}`);
  });
  if (found) return replaced.join('\n');

  const slot = lines.findIndex((line) => placeholder.test(body(line).replace(/^﻿/, '')));
  if (slot >= 0) {
    const bom = lines[slot].startsWith('﻿') ? '﻿' : '';
    lines[slot] = withCr(lines[slot], `${bom}${entry}`);
    return lines.join('\n');
  }

  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const prefix = content === '' || content.endsWith('\n') ? content : content + eol;
  return `${prefix}${entry}${eol}`;
}

/** The file's text, or null when it does not exist. */
export function readEnvFile(path: string = ENV_FILE): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

export function writeEnvFile(content: string, path: string = ENV_FILE): void {
  writeFileSync(path, content, 'utf8');
}

/**
 * Runs fn, then writes the file's original bytes back, whether fn succeeded or threw: nothing fn
 * wrote to the file survives. A file that did not exist before is left as fn left it.
 */
export function restoreFileAfter<T>(path: string, fn: () => T): T {
  const original = existsSync(path) ? readFileSync(path) : null;
  try {
    return fn();
  } finally {
    if (original !== null) writeFileSync(path, original);
  }
}

/** restoreFileAfter for several files: every one is put back, whether fn succeeded or threw. */
export function restoreFilesAfter<T>(paths: readonly string[], fn: () => T): T {
  return paths.reduceRight<() => T>((inner, path) => () => restoreFileAfter(path, inner), fn)();
}
