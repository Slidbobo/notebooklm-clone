import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";

// promisify resolves to the overload without cost parameters, which would leave
// scrypt at its defaults. The signature is restated so that the options object
// below is actually type checked instead of silently dropped.
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing for the two seeded demo accounts.
 *
 * scrypt from node:crypto rather than bcrypt or Argon2id. It is memory hard,
 * listed by OWASP as an acceptable password hash, and ships with the runtime, so
 * there is no native module to build on Vercel and no dependency to audit for a
 * feature that exists purely to let a reviewer sign in. bcrypt's 72 byte input
 * limit is also avoided.
 *
 * Cost parameters are stored in the hash string, so raising them later does not
 * invalidate existing hashes.
 */
const KEY_LENGTH = 64;
const COST = 2 ** 16;
const BLOCK_SIZE = 8;
const PARALLELISATION = 1;
// Node defaults maxmem to 32 MB; scrypt at these parameters needs 128 * N * r,
// which is 64 MB. Without this the call throws instead of hashing.
const MAX_MEMORY = 256 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISATION,
    maxmem: MAX_MEMORY,
  });

  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELISATION,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Constant-time verification. Returns false for malformed or missing hashes
 * rather than throwing, so a user row without a password (every GitHub account)
 * simply fails the credentials path instead of producing a 500 that would
 * distinguish "no password set" from "wrong password".
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, cost, blockSize, parallelisation, salt, expected] = parts;
  const expectedBuffer = Buffer.from(expected ?? "", "base64");
  if (expectedBuffer.length !== KEY_LENGTH) return false;

  const derived = await scrypt(password, Buffer.from(salt ?? "", "base64"), KEY_LENGTH, {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelisation),
    maxmem: MAX_MEMORY,
  });

  return timingSafeEqual(derived, expectedBuffer);
}
