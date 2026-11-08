import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const HASH_PREFIX = "scrypt";
const SALT_BYTES = 16;
const KEY_BYTES = 64;

// Formato: scrypt.<sal>.<hash>, en base64url (sin "$" ni "=" que rompan archivos .env).
export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_BYTES);
  return [HASH_PREFIX, salt.toString("base64url"), key.toString("base64url")].join(".");
}

export async function verifyPassword(password, storedHash) {
  const [prefix, salt, key] = String(storedHash).split(".");
  if (prefix !== HASH_PREFIX || !salt || !key) return false;

  const expected = Buffer.from(key, "base64url");
  const actual = await scrypt(String(password), Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}
