import { waitUntil } from '@vercel/functions';
import { buildDeps } from '../src/deps.js';
import { createSonioxHandler } from '../src/http.js';

export default { fetch: createSonioxHandler(() => buildDeps(), waitUntil) };
