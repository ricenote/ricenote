/**
 * 密码哈希：scrypt + 随机盐 + 常量时间比较。
 *
 * 存储格式：`scrypt$<salt-hex>$<derived-hex>`，
 * 自带算法标识与参数，便于后续平滑升级（新增算法前缀即可）。
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const ALGORITHM = 'scrypt';

/** 生成密码哈希。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `${ALGORITHM}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** 校验密码；格式非法时返回 false（不抛错，避免泄露内部格式信息）。 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const [algorithm, saltHex, derivedHex] = parts as [string, string, string];
  if (algorithm !== ALGORITHM) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(derivedHex, 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await scryptAsync(password, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** 密码强度校验（服务端二次校验，前端校验仅作体验）。 */
export function validatePasswordStrength(password: string, username: string): string | undefined {
  if (password.length < 8) return '密码长度至少 8 位';
  if (password.length > 200) return '密码长度不得超过 200 位';
  if (/^\d+$/.test(password)) return '密码不能是纯数字';
  if (password.toLowerCase() === username.toLowerCase()) return '密码不能与用户名相同';
  return undefined;
}
