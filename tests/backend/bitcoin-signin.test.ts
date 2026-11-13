import { describe, expect, it } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { concat, ripemd160, sha256, toHex } from "viem";
import { bitcoinMessageHash, orangeKitSafeFromBitcoinSignature, predictOrangeKitSafe, verifyBitcoinSignIn } from "@/lib/server/bitcoin-signin";

const hash160 = (b: Uint8Array) => ripemd160(sha256(b, "bytes"), "bytes");

/** BIP-137 signature: header byte (base + recovery id) then r ‖ s, as OrangeKit normalises it. */
function bip137(priv: Uint8Array, message: string, base: 27 | 31 | 35 | 39): `0x${string}` {
  const sig = secp256k1.sign(bitcoinMessageHash(message), priv);
  return toHex(concat([Uint8Array.of(base + sig.recovery), sig.toCompactRawBytes()]));
}

describe("predictOrangeKitSafe", () => {
  // Vectors from @mezo-org/orangekit-smart-account predictOrangeKitAddress.test.ts (generated on-chain).
  it.each([
    ["0x0000000000000000000000000000000000000000", "0xd84C120D84CC795F9b5649594B916A961C64f387"],
    ["0xffffffffffffffffffffffffffffffffffffffff", "0x1Ae9407f0FA2f165cC28767750bBCd0219540c62"],
    ["0x1234567890abcdef1234567890abcdef12345678", "0xc6Dc4b63f691de9ec6E495Fe3b1207C1CABa5370"],
    ["0x00000000000000000000000000000000000000ff", "0xF3cD2c9660B19F68d9F4CD99Be10C057ed3A766A"],
  ] as const)("%s → %s", (truncated, safe) => {
    expect(predictOrangeKitSafe(truncated)).toBe(safe);
  });

  it("matches OrangeKit's vector for testnet P2PKH mv4rnyY3Su5gjcDNzbMLKBQkBicCtHUtFB", () => {
    // OrangeKit takes the pubkey hash straight from a P2PKH address: version 0x6f, hash 9f9a7abd…cb2fafda.
    expect(predictOrangeKitSafe("0x9f9a7abd600c0caa03983a77c8c3df8e062cb2fa")).toBe("0x6083Bde64CCBF08470a1a0dAa9a0281B4951be7C");
  });
});

describe("Bitcoin sign-in (BIP-137 → OrangeKit Safe)", () => {
  const priv = secp256k1.utils.randomPrivateKey();
  const pubC = secp256k1.getPublicKey(priv, true);
  const pubU = secp256k1.getPublicKey(priv, false);
  const msg = "MezoGuard sign-in\nlocalhost wants you to sign in.\nNonce: abc123";

  it("P2WPKH and compressed P2PKH map to hash160(compressed pubkey)", () => {
    const safe = predictOrangeKitSafe(toHex(hash160(pubC)));
    expect(orangeKitSafeFromBitcoinSignature(msg, bip137(priv, msg, 39))).toBe(safe);
    expect(orangeKitSafeFromBitcoinSignature(msg, bip137(priv, msg, 31))).toBe(safe);
    expect(verifyBitcoinSignIn(safe, msg, bip137(priv, msg, 39))).toBe(true);
  });

  it("uncompressed P2PKH maps to hash160(uncompressed pubkey)", () => {
    const safe = predictOrangeKitSafe(toHex(hash160(pubU)));
    expect(orangeKitSafeFromBitcoinSignature(msg, bip137(priv, msg, 27))).toBe(safe);
  });

  it("P2SH-P2WPKH maps to the redeem-script hash", () => {
    const redeem = hash160(concat([Uint8Array.of(0x00, 0x14), hash160(pubC)]));
    expect(orangeKitSafeFromBitcoinSignature(msg, bip137(priv, msg, 35))).toBe(predictOrangeKitSafe(toHex(redeem)));
  });

  it("rejects a different message, another key's Safe, and malformed signatures", () => {
    const safe = predictOrangeKitSafe(toHex(hash160(pubC)));
    const sig = bip137(priv, msg, 39);
    expect(verifyBitcoinSignIn(safe, msg + "x", sig)).toBe(false);
    const other = predictOrangeKitSafe(toHex(hash160(secp256k1.getPublicKey(secp256k1.utils.randomPrivateKey(), true))));
    expect(verifyBitcoinSignIn(other, msg, sig)).toBe(false);
    expect(orangeKitSafeFromBitcoinSignature(msg, "0x1234")).toBeNull();
    expect(orangeKitSafeFromBitcoinSignature(msg, `0x2b${sig.slice(4)}`)).toBeNull(); // header 43 out of range
  });

  it("handles messages longer than 252 bytes (multi-byte varint)", () => {
    const long = msg + "\n" + "a".repeat(400);
    const safe = predictOrangeKitSafe(toHex(hash160(pubC)));
    expect(verifyBitcoinSignIn(safe, long, bip137(priv, long, 39))).toBe(true);
  });
});

describe.skipIf(!process.env.LIVE)("LIVE: OrangeKit factory on Mezo testnet agrees with predictOrangeKitSafe", () => {
  it.each(["0x9f9a7abd600c0caa03983a77c8c3df8e062cb2fa", "0x1234567890abcdef1234567890abcdef12345678"] as const)("%s", async (truncated) => {
    const { createPublicClient, http, parseAbi } = await import("viem");
    const { mezoTestnet } = await import("@/lib/chain/config");
    const { ORANGEKIT_SAFE_FACTORY } = await import("@/lib/server/bitcoin-signin");
    const client = createPublicClient({ chain: mezoTestnet, transport: http() });
    const [safe] = await client.readContract({
      address: ORANGEKIT_SAFE_FACTORY,
      abi: parseAbi(["function predictAddresses(bytes20 truncatedBitcoinAddress) view returns (address safe, address bitcoinSafeOwner)"]),
      functionName: "predictAddresses",
      args: [truncated],
    });
    expect(safe).toBe(predictOrangeKitSafe(truncated));
  });
});
