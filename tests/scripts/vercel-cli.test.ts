import {
  envRemoveArgs,
  isAtLeast,
  isMissingVariable,
  parseCliVersion,
  parseDeploymentUrl,
  pickProductionAlias,
  setEnvFailure,
} from '../../scripts/lib/vercel-cli.js';

describe('envRemoveArgs / isMissingVariable', () => {
  it('confirms by name from 65.15.0, with --yes before', () => {
    expect(envRemoveArgs('OPENAI_API_KEY', '66.5.0')).toEqual([
      'env', 'remove', 'OPENAI_API_KEY', '--environment', 'production', '--confirm-name', 'OPENAI_API_KEY',
    ]);
    expect(envRemoveArgs('OPENAI_API_KEY', '65.15.0')).toContain('--confirm-name');
    expect(envRemoveArgs('OPENAI_API_KEY', '65.14.0')).toEqual([
      'env', 'remove', 'OPENAI_API_KEY', '--environment', 'production', '--yes',
    ]);
  });

  it('treats a variable that is not on production as already removed', () => {
    expect(isMissingVariable('Error: Environment Variable was not found.')).toBe(true);
    expect(isMissingVariable('{"reason":"env_not_found","message":"Environment Variable X was not found."}')).toBe(true);
    expect(isMissingVariable('The selected environment does not match this variable. No changes were made.')).toBe(true);
    expect(isMissingVariable('Error: You are not authorized')).toBe(false);
  });
});

describe('parseCliVersion / isAtLeast', () => {
  it('reads the version from `vercel --version` output', () => {
    expect(parseCliVersion('Vercel CLI 66.5.0 (native)\n66.5.0\n')).toBe('66.5.0');
    expect(parseCliVersion('command not found')).toBeNull();
  });

  it('compares versions numerically', () => {
    expect(isAtLeast('64.6.0', '64.6.0')).toBe(true);
    expect(isAtLeast('64.10.0', '64.6.0')).toBe(true);
    expect(isAtLeast('100.0.0', '64.6.0')).toBe(true);
    expect(isAtLeast('64.5.9', '64.6.0')).toBe(false);
    expect(isAtLeast('39.1.0', '64.6.0')).toBe(false);
  });
});

describe('parseDeploymentUrl', () => {
  it('takes the last https URL on stdout, ignoring color codes', () => {
    expect(parseDeploymentUrl('\u001b[1mhttps://tamlil-bot-abc123-me.vercel.app\u001b[22m\n')).toBe(
      'https://tamlil-bot-abc123-me.vercel.app',
    );
    expect(parseDeploymentUrl('nothing here')).toBeNull();
  });
});

describe('pickProductionAlias', () => {
  const inspect = {
    id: 'dpl_1',
    name: 'tamlil-bot',
    url: 'tamlil-bot-abc123-me.vercel.app',
    target: 'production',
    aliases: ['tamlil-bot-me.vercel.app', 'tamlil-bot-git-main-me.vercel.app', 'tamlil-bot.vercel.app'],
  };

  it('prefers <project>.vercel.app', () => expect(pickProductionAlias(inspect)).toBe('https://tamlil-bot.vercel.app'));

  it('otherwise takes the shortest vercel.app alias that is not the deployment or a git alias', () => {
    expect(
      pickProductionAlias({
        ...inspect,
        aliases: ['tamlil-bot-git-main-me.vercel.app', 'tamlil-bot-me.vercel.app', 'tamlil-bot-abc123-me.vercel.app'],
      }),
    ).toBe('https://tamlil-bot-me.vercel.app');
  });

  it('never returns the per-deployment URL or a custom domain', () => {
    expect(pickProductionAlias({ ...inspect, aliases: ['tamlil-bot-abc123-me.vercel.app', 'bot.example.com'] })).toBeNull();
    expect(pickProductionAlias({ ...inspect, aliases: undefined })).toBeNull();
    expect(pickProductionAlias(null)).toBeNull();
  });
});

describe('setEnvFailure', () => {
  it('shows both outputs when add failed for another reason and update failed too', () => {
    const err = setEnvFailure('OPENAI_API_KEY', 'Error: not authorized to add', 'Error: team not found');
    expect(err.message).toBe('Saving OPENAI_API_KEY to Vercel failed');
    expect(err.output).toContain('env add: Error: not authorized to add');
    expect(err.output).toContain('env update: Error: team not found');
  });

  it('shows only the update output when add failed because the variable exists', () => {
    const err = setEnvFailure('X_Y', 'Error: Environment Variable "X_Y" already exists', 'Error: update failed');
    expect(err.output).toBe('Error: update failed');
  });
});
