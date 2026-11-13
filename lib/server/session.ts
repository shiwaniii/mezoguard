/**
 * EIP-191 sign-in + HMAC session cookies.
 *
 * Flow: GET /api/auth/nonce?address=0x… → { message } and an httpOnly `mg_nonce` cookie (HMAC'd, 10 min).
 *       Wallet signs `message` (personal_sign). POST /api/auth/verify { address, message, signature } →
 *       we check domain, address, nonce (must equal the cookie's), issued/expiry, then viem verifyMessage, or for
 *       Mezo Passport Bitcoin wallets a BIP-137 signature whose key owns the OrangeKit Safe at `address`.
 *       On success the user row is upserted and an httpOnly `mg_session` cookie (HMAC, 7 days) is set.
 */
import "./guard";
import crypto from "node:crypto";
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";
import { MEZO_TESTNET_ID } from "@/lib/chain/config";
import { verifyBitcoinSignIn } from "./bitcoin-signin";

export const NONCE_COOKIE = "mg_nonce";
export const SESSION_COOKIE = "mg_session";
export const NONCE_TTL_SECONDS = 10 * 60;
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const MESSAGE_HEADER = "MezoGuard sign-in";

let devSecret: string | null = null;

/** HMAC key. In production SESSION_SECRET is required; in dev a random per-process key is used (sessions reset on restart). */
export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") throw new SessionConfigError("SESSION_SECRET (≥16 chars) is not configured");
  if (!devSecret) devSecret = crypto.randomBytes(32).toString("hex");
  return devSecret;
}

export class SessionConfigError extends Error {}

const b64u = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url").toString("utf8");

function hmac(data: string, purpose: string): string {
  return crypto.createHmac("sha256", sessionSecret()).update(`${purpose}\n${data}`).digest("base64url");
}

/** `base64url(json).hmac` */
export function signToken(obj: object, purpose: string): string {
  const body = b64u(JSON.stringify(obj));
  return `${body}.${hmac(body, purpose)}`;
}

export function verifyToken<T>(token: string | undefined | null, purpose: string): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = hmac(body, purpose);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(unb64u(body)) as T;
  } catch {
    return null;
  }
}

// ---------------- sign-in message ----------------
export interface SignInFields {
  domain: string;
  address: Address | null;
  nonce: string;
  issuedAt: string; // ISO
  expirationTime: string; // ISO
  chainId: number;
}

export function buildSignInMessage(f: SignInFields): string {
  return [
    MESSAGE_HEADER,
    "",
    `${f.domain} wants you to sign in to manage MezoGuard alerts. This signature does not send a transaction or cost gas.`,
    "",
    `Domain: ${f.domain}`,
    `Address: ${f.address ?? "(the signing wallet)"}`,
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
    `Expiration Time: ${f.expirationTime}`,
  ].join("\n");
}

export function parseSignInMessage(message: string): SignInFields | null {
  if (!message.startsWith(MESSAGE_HEADER + "\n")) return null;
  const field = (name: string) => {
    const m = message.match(new RegExp(`^${name}: (.+)$`, "m"));
    return m ? m[1].trim() : null;
  };
  const domain = field("Domain");
  const addr = field("Address");
  const nonce = field("Nonce");
  const issuedAt = field("Issued At");
  const expirationTime = field("Expiration Time");
  const chainId = Number(field("Chain ID"));
  if (!domain || !addr || !nonce || !issuedAt || !expirationTime || !Number.isFinite(chainId)) return null;
  return {
    domain,
    address: isAddress(addr) ? getAddress(addr) : null,
    nonce,
    issuedAt,
    expirationTime,
    chainId,
  };
}

interface NonceToken {
  n: string;
  exp: number; // unix s
}

export function createNonce(domain: string, address: Address | null, now = Date.now()) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const issuedAt = new Date(now).toISOString();
  const exp = Math.floor(now / 1000) + NONCE_TTL_SECONDS;
  const message = buildSignInMessage({
    domain,
    address,
    nonce,
    issuedAt,
    expirationTime: new Date(exp * 1000).toISOString(),
    chainId: MEZO_TESTNET_ID,
  });
  return { nonce, message, cookie: signToken({ n: nonce, exp } satisfies NonceToken, "nonce"), maxAge: NONCE_TTL_SECONDS };
}

export type VerifyResult = { ok: true; address: Address } | { ok: false; error: string };

export async function verifySignIn(args: {
  address: string;
  message: string;
  signature: string;
  nonceCookie: string | undefined;
  domain: string;
  now?: number;
}): Promise<VerifyResult> {
  const now = args.now ?? Date.now();
  if (!isAddress(args.address)) return { ok: false, error: "invalid address" };
  const address = getAddress(args.address);
  const fields = parseSignInMessage(args.message);
  if (!fields) return { ok: false, error: "malformed sign-in message" };
  const nonceTok = verifyToken<NonceToken>(args.nonceCookie, "nonce");
  if (!nonceTok) return { ok: false, error: "missing or tampered nonce cookie — request a new message" };
  if (nonceTok.exp * 1000 < now) return { ok: false, error: "nonce expired — request a new message" };
  if (fields.nonce !== nonceTok.n) return { ok: false, error: "nonce mismatch" };
  if (fields.domain !== args.domain) return { ok: false, error: "domain mismatch" };
  if (fields.chainId !== MEZO_TESTNET_ID) return { ok: false, error: "wrong chain id" };
  if (fields.address && fields.address !== address) return { ok: false, error: "address mismatch" };
  const exp = Date.parse(fields.expirationTime);
  const iat = Date.parse(fields.issuedAt);
  if (!Number.isFinite(exp) || exp < now) return { ok: false, error: "message expired" };
  if (!Number.isFinite(iat) || iat > now + 60_000) return { ok: false, error: "message issued in the future" };
  if (!/^0x[0-9a-fA-F]+$/.test(args.signature)) return { ok: false, error: "invalid signature encoding" };
  let valid = false;
  try {
    valid = await verifyMessage({ address, message: args.message, signature: args.signature as Hex });
  } catch {
    valid = false;
  }
  // Mezo Passport Bitcoin wallets: the address is an OrangeKit Safe and the signature is BIP-137 from the Bitcoin key.
  if (!valid) valid = verifyBitcoinSignIn(address, args.message, args.signature);
  if (!valid) return { ok: false, error: "signature does not match address" };
  return { ok: true, address };
}

// ---------------- session ----------------
export interface Session {
  uid: string;
  addr: Address;
  exp: number; // unix s
}

export function createSessionToken(userId: string, address: Address, now = Date.now()): { token: string; maxAge: number } {
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  return { token: signToken({ uid: userId, addr: address, exp } satisfies Session, "session"), maxAge: SESSION_TTL_SECONDS };
}

export function readSessionToken(token: string | undefined | null, now = Date.now()): Session | null {
  let s: Session | null;
  try {
    s = verifyToken<Session>(token, "session");
  } catch {
    return null; // misconfigured secret → treat as signed out
  }
  if (!s || typeof s.uid !== "string" || typeof s.addr !== "string" || s.exp * 1000 < now) return null;
  return s;
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
