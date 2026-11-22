import { StepFailure, crash, hideSecrets, scrub, step } from '../../scripts/lib/report.js';

function captureLog(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
    lines.push(String(line ?? ''));
  });
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('scrub / hideSecrets', () => {
  const token = '123456789:AAHsecretTokenValue';

  it('replaces a registered secret wherever it appears, including inside a longer string', () => {
    hideSecrets([token]);
    const url = `https://api.telegram.org/bot${token}/setWebhook`;
    expect(scrub(url)).toBe('https://api.telegram.org/bot[hidden]/setWebhook');
    expect(scrub(`a ${token} b ${token}`)).toBe('a [hidden] b [hidden]');
  });

  it('does not register empty, blank or short values, so normal text is never blanked', () => {
    hideSecrets(['', '   ', 'abc', 'short', null, undefined]);
    expect(scrub('abc short and  spaces')).toBe('abc short and  spaces');
  });

  it('leaves output without secrets unchanged', () => {
    expect(scrub('✓ Telegram bot token: @my_bot')).toBe('✓ Telegram bot token: @my_bot');
  });
});

describe('crash', () => {
  it('prints the script footer after the summary', () => {
    const lines = captureLog();
    crash(new Error('boom'), () => ['Your bot: https://t.me/my_bot', 'Access:   locked']);
    const text = lines.join('\n');
    expect(text).toContain('Unexpected error: boom');
    expect(text).toContain('Your bot: https://t.me/my_bot');
    expect(text.indexOf('Summary')).toBeLessThan(text.indexOf('Your bot:'));
    expect(process.exitCode).toBe(1);
  });

  it('still prints the summary when the footer provider throws', () => {
    const lines = captureLog();
    crash(new Error('boom'), () => {
      throw new Error('footer broke');
    });
    expect(lines.join('\n')).toContain('Summary');
  });
});

describe('step default hint', () => {
  it('uses the given default hint unless the failure has its own', async () => {
    const lines = captureLog();
    await step(
      'x',
      () => {
        throw new Error('bad');
      },
      'see the README',
    );
    await step(
      'y',
      () => {
        throw new StepFailure('bad', 'own hint');
      },
      'see the README',
    );
    expect(lines).toContain('    → see the README');
    expect(lines).toContain('    → own hint');
  });
});
