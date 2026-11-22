import { loadConfig } from './config.js';
import type { Deps } from './deliver.js';
import { logger } from './log.js';
import { createSonioxGateway } from './soniox.js';
import { getStrings } from './strings/index.js';
import { createSummarizer } from './summarize.js';
import { createTelegramClient } from './telegram.js';

let cached: Deps | undefined;

/**
 * Builds the dependency set from the environment. Memoized per process only on the
 * production path (no arguments); calls with arguments always build fresh. Throws ConfigError.
 */
export function buildDeps(
  env?: Record<string, string | undefined>,
  opts?: { requireWebhookSecrets?: boolean },
): Deps {
  const memoize = env === undefined && opts === undefined;
  if (memoize && cached) return cached;

  const config = loadConfig(env ?? process.env, opts);
  const deps: Deps = {
    tg: createTelegramClient(config.telegramToken),
    soniox: createSonioxGateway(config),
    summarizer: createSummarizer(config),
    config,
    s: getStrings(config.lang),
    log: logger,
  };
  if (memoize) cached = deps;
  return deps;
}
