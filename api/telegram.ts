import { waitUntil } from '@vercel/functions';
import { buildDeps } from '../src/deps.js';
import { createTelegramHandler } from '../src/http.js';

export default { fetch: createTelegramHandler(() => buildDeps(), waitUntil) };
