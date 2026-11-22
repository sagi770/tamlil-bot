import type { Config } from './config.js';

export type AccessMode = 'locked' | 'open-warn' | 'open';
type AccessConfig = Pick<Config, 'allowedUserIds' | 'invalidUserIds' | 'allowAllUsers'>;

/** A non-empty ALLOWED_USER_IDS always locks, even when none of its entries is a valid id. */
export function accessMode(c: AccessConfig): AccessMode {
  if (c.allowedUserIds.length > 0 || c.invalidUserIds.length > 0) return 'locked';
  return c.allowAllUsers ? 'open' : 'open-warn';
}

export function isAllowed(c: AccessConfig, userId: number): boolean {
  return accessMode(c) === 'locked' ? c.allowedUserIds.includes(userId) : true;
}
