const ENV = {
  TELEGRAM_BOT_TOKEN: 't',
  SONIOX_API_KEY: 's',
  TELEGRAM_WEBHOOK_SECRET: 'a',
  SONIOX_WEBHOOK_SECRET: 'b',
};

/**
 * A fresh module graph per test, so the production-path memo never leaks between tests.
 * ConfigError and getStrings come from the same graph, so identity checks hold.
 */
async function load() {
  vi.resetModules();
  const { buildDeps } = await import('../src/deps.js');
  const { ConfigError } = await import('../src/config.js');
  const { getStrings } = await import('../src/strings/index.js');
  return { buildDeps, ConfigError, getStrings };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildDeps', () => {
  it('wires config, language and summarizer from the environment', async () => {
    const { buildDeps, getStrings } = await load();
    const deps = buildDeps({ ...ENV, BOT_LANGUAGE: 'en', OPENAI_API_KEY: 'k' });
    expect(deps.config.telegramToken).toBe('t');
    expect(deps.s).toBe(getStrings('en'));
    expect(deps.s).not.toBe(getStrings('he'));
    expect(deps.summarizer).not.toBeNull();
    expect(deps.tg).toBeDefined();
    expect(deps.soniox).toBeDefined();
  });

  it('has no summarizer without an OpenAI key', async () => {
    const { buildDeps } = await load();
    expect(buildDeps(ENV).summarizer).toBeNull();
  });

  it('does not memoize when called with arguments', async () => {
    const { buildDeps } = await load();
    expect(buildDeps(ENV)).not.toBe(buildDeps(ENV));
  });

  it('throws ConfigError naming the missing variables', async () => {
    const { buildDeps, ConfigError } = await load();
    expect(() => buildDeps({})).toThrow(ConfigError);
  });

  it('passes opts to loadConfig', async () => {
    const { buildDeps, ConfigError } = await load();
    const partial = { TELEGRAM_BOT_TOKEN: 't', SONIOX_API_KEY: 's' };
    expect(() => buildDeps(partial)).toThrow(ConfigError);
    expect(buildDeps(partial, { requireWebhookSecrets: false }).config.telegramWebhookSecret).toBe('');
  });

  it('memoizes the production path (no arguments)', async () => {
    for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
    const { buildDeps } = await load();
    expect(buildDeps()).toBe(buildDeps());
  });
});
