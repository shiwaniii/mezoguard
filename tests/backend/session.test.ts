import { describe, it, expect, beforeAll } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  createNonce, verifySignIn, createSessionToken, readSessionToken, parseSignInMessage, signToken, verifyToken,
} from "@/lib/server/session";

const account = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const DOMAIN = "mezoguard.test";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-0123456789abcdef";
});

describe("EIP-191 sign-in", () => {
  it("accepts a valid signature from the address in the message", async () => {
    const n = createNonce(DOMAIN, account.address);
    const f = parseSignInMessage(n.message)!;
    expect(f).toMatchObject({ domain: DOMAIN, address: account.address, nonce: n.nonce, chainId: 31611 });
    expect(n.message.startsWith("MezoGuard sign-in\n")).toBe(true);
    const signature = await account.signMessage({ message: n.message });
    const r = await verifySignIn({ address: account.address, message: n.message, signature, nonceCookie: n.cookie, domain: DOMAIN });
    expect(r).toEqual({ ok: true, address: account.address });
  });

  it("rejects a signature by a different key", async () => {
    const n = createNonce(DOMAIN, account.address);
    const signature = await other.signMessage({ message: n.message });
    const r = await verifySignIn({ address: account.address, message: n.message, signature, nonceCookie: n.cookie, domain: DOMAIN });
    expect(r.ok).toBe(false);
  });

  it("rejects a nonce that doesn't match the cookie (replay of another message)", async () => {
    const a = createNonce(DOMAIN, account.address);
    const b = createNonce(DOMAIN, account.address);
    const signature = await account.signMessage({ message: a.message });
    const r = await verifySignIn({ address: account.address, message: a.message, signature, nonceCookie: b.cookie, domain: DOMAIN });
    expect(r).toEqual({ ok: false, error: "nonce mismatch" });
  });

  it("rejects a tampered nonce cookie, wrong domain, expired message, address mismatch", async () => {
    const n = createNonce(DOMAIN, account.address);
    const signature = await account.signMessage({ message: n.message });
    const base = { address: account.address, message: n.message, signature, domain: DOMAIN };
    expect((await verifySignIn({ ...base, nonceCookie: n.cookie.slice(0, -2) + "xx" })).ok).toBe(false);
    expect((await verifySignIn({ ...base, nonceCookie: undefined })).ok).toBe(false);
    expect(await verifySignIn({ ...base, nonceCookie: n.cookie, domain: "evil.test" })).toEqual({ ok: false, error: "domain mismatch" });
    expect((await verifySignIn({ ...base, nonceCookie: n.cookie, now: Date.now() + 11 * 60_000 })).ok).toBe(false);
    expect(await verifySignIn({ ...base, nonceCookie: n.cookie, address: other.address })).toEqual({ ok: false, error: "address mismatch" });
  });

  it("works when the nonce was requested without an address (recovered signer must equal body address)", async () => {
    const n = createNonce(DOMAIN, null);
    const signature = await account.signMessage({ message: n.message });
    expect((await verifySignIn({ address: account.address, message: n.message, signature, nonceCookie: n.cookie, domain: DOMAIN })).ok).toBe(true);
    expect((await verifySignIn({ address: other.address, message: n.message, signature, nonceCookie: n.cookie, domain: DOMAIN })).ok).toBe(false);
  });
});

describe("session cookie", () => {
  it("round-trips and rejects tampering/expiry", () => {
    const { token } = createSessionToken("user-1", account.address);
    expect(readSessionToken(token)).toMatchObject({ uid: "user-1", addr: account.address });
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "user-2", addr: account.address, exp: 9_999_999_999 })).toString("base64url");
    expect(readSessionToken(`${forged}.${mac}`)).toBeNull();
    expect(readSessionToken(`${body}.${mac}x`)).toBeNull();
    expect(readSessionToken(token, Date.now() + 8 * 24 * 3600_000)).toBeNull();
  });

  it("purposes are domain-separated (a nonce token is not a session token)", () => {
    const t = signToken({ uid: "u", addr: account.address, exp: 9_999_999_999 }, "nonce");
    expect(verifyToken(t, "nonce")).not.toBeNull();
    expect(readSessionToken(t)).toBeNull();
  });
});

describe("Mezo Passport Bitcoin wallet sign-in (OrangeKit Safe + BIP-137)", () => {
  it("signs in the Safe owned by the Bitcoin key, and only that Safe", async () => {
    const { secp256k1 } = await import("@noble/curves/secp256k1");
    const { concat, ripemd160, sha256, toHex } = await import("viem");
    const { bitcoinMessageHash, predictOrangeKitSafe } = await import("@/lib/server/bitcoin-signin");
    const priv = secp256k1.utils.randomPrivateKey();
    const safe = predictOrangeKitSafe(toHex(ripemd160(sha256(secp256k1.getPublicKey(priv, true), "bytes"), "bytes")));
    const n = createNonce(DOMAIN, safe);
    const s = secp256k1.sign(bitcoinMessageHash(n.message), priv);
    const signature = toHex(concat([Uint8Array.of(39 + s.recovery), s.toCompactRawBytes()])); // P2WPKH header
    expect(await verifySignIn({ address: safe, message: n.message, signature, nonceCookie: n.cookie, domain: DOMAIN })).toEqual({ ok: true, address: safe });
    const n2 = createNonce(DOMAIN, null);
    const s2 = secp256k1.sign(bitcoinMessageHash(n2.message), priv);
    const sig2 = toHex(concat([Uint8Array.of(39 + s2.recovery), s2.toCompactRawBytes()]));
    expect((await verifySignIn({ address: other.address, message: n2.message, signature: sig2, nonceCookie: n2.cookie, domain: DOMAIN })).ok).toBe(false);
  });
});
