/**
 * Sign-in for Mezo Passport Bitcoin wallets (Unisat, OKX, Xverse).
 *
 * Passport gives these users an OrangeKit smart account (a Safe) as their EVM address. Their wallet signs our
 * sign-in message with the Bitcoin key (BIP-137, normalised by OrangeKit to a 65-byte hex signature, header byte
 * first). We recover the public key, derive the "truncated Bitcoin address" OrangeKit uses as the Safe's salt, and
 * predict the Safe address with CREATE2 exactly like `@mezo-org/orangekit-smart-account` predictOrangeKitAddress.
 * The sign-in is valid only if that Safe is the address being signed in. Supported: P2PKH (compressed and
 * uncompressed), P2SH-P2WPKH, P2WPKH — the same set OrangeKit supports (no Taproot).
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { concat, encodePacked, getAddress, getContractAddress, hexToBytes, keccak256, ripemd160, sha256, toBytes, type Address, type Hex } from "viem";

/** OrangeKit Safe factory and Safe proxy bytecode hash (same on every network), from orangekit-smart-account. */
export const ORANGEKIT_SAFE_FACTORY: Address = "0x7E80bd5A2E8Fca0B160254D43aC9f43AC2cC1052";
const ORANGEKIT_BYTECODE_HASH: Hex = "0x2ebd335f0ee339c4d1338b7275d9b30185802a35ba476be7906f8fb67cfe6e96";

export function predictOrangeKitSafe(truncatedBitcoinAddress: Hex): Address {
  if (truncatedBitcoinAddress.length !== 42) throw new Error("Truncated Bitcoin address must be 20 bytes long");
  return getContractAddress({
    opcode: "CREATE2",
    from: ORANGEKIT_SAFE_FACTORY,
    salt: keccak256(encodePacked(["bytes20"], [truncatedBitcoinAddress])),
    bytecodeHash: ORANGEKIT_BYTECODE_HASH,
  });
}

const hash160 = (b: Uint8Array): Uint8Array => ripemd160(sha256(b, "bytes"), "bytes");

function varint(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
  return Uint8Array.of(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
}

/** Bitcoin signed-message digest: sha256d("\x18Bitcoin Signed Message:\n" ‖ varint(len) ‖ message). */
export function bitcoinMessageHash(message: string): Uint8Array {
  const msg = toBytes(message);
  const data = concat([toBytes("\x18Bitcoin Signed Message:\n"), varint(msg.length), msg]);
  return sha256(sha256(data, "bytes"), "bytes");
}

/**
 * Returns the OrangeKit Safe address controlled by the key that produced `signature` over `message`,
 * or null if the signature is not a well-formed BIP-137 signature.
 */
export function orangeKitSafeFromBitcoinSignature(message: string, signature: string): Address | null {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return null;
  const bytes = hexToBytes(signature as Hex);
  const header = bytes[0];
  if (header < 27 || header > 42) return null;
  // BIP-137 header ranges: 27-30 P2PKH uncompressed, 31-34 P2PKH compressed, 35-38 P2SH-P2WPKH, 39-42 P2WPKH.
  const base = header >= 39 ? 39 : header >= 35 ? 35 : header >= 31 ? 31 : 27;
  const recovery = header - base;
  let point;
  try {
    point = secp256k1.Signature.fromCompact(bytes.slice(1)).addRecoveryBit(recovery).recoverPublicKey(bitcoinMessageHash(message));
  } catch {
    return null;
  }
  const pubkeyHash = hash160(point.toRawBytes(base !== 27));
  const truncated =
    base === 35
      ? hash160(concat([Uint8Array.of(0x00, 0x14), pubkeyHash])) // P2SH-P2WPKH: hash of the redeem script
      : pubkeyHash; // P2PKH / P2WPKH: pubkey hash
  return predictOrangeKitSafe(`0x${Buffer.from(truncated).toString("hex")}` as Hex);
}

export function verifyBitcoinSignIn(address: Address, message: string, signature: string): boolean {
  const safe = orangeKitSafeFromBitcoinSignature(message, signature);
  return safe !== null && getAddress(safe) === getAddress(address);
}
