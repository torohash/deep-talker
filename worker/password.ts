import { argon2idAsync } from "@noble/hashes/argon2.js";

const parameters = { m: 19 * 1024, t: 2, p: 1, dkLen: 32 };
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (text: string) =>
  Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await argon2idAsync(password, salt, parameters);
  return `argon2id$${encode(salt)}$${encode(hash)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [, salt, stored] = encoded.split("$");
  const expected = decode(stored);
  const actual = await argon2idAsync(password, decode(salt), parameters);
  let difference = expected.length ^ actual.length;
  for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newToken(): string {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}
