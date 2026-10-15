/**
 * password.service.js
 *
 * Password hashing with scrypt (built into Node's crypto). Each hash carries
 * its own random salt and cost parameters:
 *   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
 */

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const COST = { N: 16384, r: 8, p: 1 };

function derive(password, salt, { N, r, p }) {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await derive(password, Buffer.from(saltB64, 'base64'), { N: Number(N), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Used when an email is unknown, so a login attempt costs the same time either way
let dummyHash = null;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword('not-a-real-password-placeholder');
  await verifyPassword(password, dummyHash);
}
