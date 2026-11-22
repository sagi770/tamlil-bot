import { accessMode, isAllowed } from '../src/access.js';

const cfg = (allowedUserIds: number[], allowAllUsers: boolean, invalidUserIds: string[] = []) => ({
  allowedUserIds,
  invalidUserIds,
  allowAllUsers,
});

describe('access', () => {
  it('is locked when ids are set', () => expect(accessMode(cfg([1], false))).toBe('locked'));
  it('locked wins over ALLOW_ALL_USERS', () => expect(accessMode(cfg([1], true))).toBe('locked'));
  it('warns when nothing is set', () => expect(accessMode(cfg([], false))).toBe('open-warn'));
  it('is open on purpose', () => expect(accessMode(cfg([], true))).toBe('open'));
  it('allows only listed users when locked', () => {
    expect(isAllowed(cfg([1], false), 1)).toBe(true);
    expect(isAllowed(cfg([1], false), 2)).toBe(false);
  });
  it('allows everyone when not locked', () => expect(isAllowed(cfg([], false), 2)).toBe(true));
  it('stays locked, to nobody, when the list has only invalid entries', () => {
    expect(accessMode(cfg([], false, ['@user']))).toBe('locked');
    expect(accessMode(cfg([], true, ['@user']))).toBe('locked');
    expect(isAllowed(cfg([], false, ['@user']), 2)).toBe(false);
  });
});
