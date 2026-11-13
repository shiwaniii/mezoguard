/** Thin fetch wrapper for our own HTTP API (docs/ARCHITECTURE.md). Errors carry status + code. */
import { getAddress, isAddress, type Address } from "viem";

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "ApiRequestError";
  }
  get dbDisabled() {
    return this.status === 503 && this.code === "DB_DISABLED";
  }
  get unauthorized() {
    return this.status === 401 || this.status === 403;
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; code?: string };
    throw new ApiRequestError(b.error ?? `Request failed (${res.status})`, res.status, b.code);
  }
  return body as T;
}

/** Validates and checksums an EVM address. ENS is not available on Mezo. */
export function parseAddressInput(input: string): { ok: true; address: Address } | { ok: false; error: string } {
  const v = input.trim();
  if (!v) return { ok: false, error: "Enter a wallet address." };
  if (/\.(eth|xyz|mezo)$/i.test(v)) return { ok: false, error: "Names are not supported on Mezo. Paste the 0x address." };
  if (!/^0x/i.test(v)) return { ok: false, error: "Addresses start with 0x." };
  if (v.length !== 42) return { ok: false, error: "That address is the wrong length. It should be 42 characters." };
  if (!isAddress(v, { strict: false })) return { ok: false, error: "That is not a valid address." };
  if (/[A-F]/.test(v.slice(2)) && /[a-f]/.test(v.slice(2)) && !isAddress(v, { strict: true })) {
    return { ok: false, error: "The address checksum does not match. Check for a typo." };
  }
  return { ok: true, address: getAddress(v) };
}

export function shortAddress(a: string, chars = 4): string {
  if (!a || a.length < 2 * chars + 2) return a;
  return `${a.slice(0, chars + 2)}…${a.slice(-chars)}`;
}
