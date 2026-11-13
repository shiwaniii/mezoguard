/** Route-handler helpers shared by app/api/**. */
import "./guard";
import { NextResponse, type NextRequest } from "next/server";
import { getDb, type Db } from "./db";
import { readSessionToken, SESSION_COOKIE, type Session } from "./session";
import { rateLimit } from "./ratelimit";
import type { ApiError } from "@/lib/api-types";

export function json<T>(data: T, init?: number | ResponseInit): NextResponse<T> {
  const ri = typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, { ...ri, headers: { "Cache-Control": "no-store", ...(ri?.headers ?? {}) } });
}

export function apiError(status: number, error: string, code?: string, headers?: Record<string, string>): NextResponse<ApiError> {
  return json<ApiError>(code ? { error, code } : { error }, { status, headers });
}

export const dbDisabled = () =>
  apiError(503, "Alerts need the server database (set DATABASE_URL or MEZOGUARD_DB=pglite)", "DB_DISABLED");

export function clientIp(req: NextRequest | Request): string {
  const h = req.headers;
  return (h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local").slice(0, 64);
}

/** Host the browser used (for the sign-in message domain). */
export function requestDomain(req: NextRequest | Request): string {
  const h = req.headers;
  return (h.get("x-forwarded-host") || h.get("host") || new URL(req.url).host).split(",")[0].trim();
}

export function getSession(req: NextRequest): Session | null {
  return readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

/** DB + valid session, or the error response to return. */
export function requireSession(req: NextRequest): { db: Db; session: Session } | NextResponse<ApiError> {
  const db = getDb();
  if (!db) return dbDisabled();
  const session = getSession(req);
  if (!session) return apiError(401, "Sign in with your wallet first", "UNAUTHENTICATED");
  return { db, session };
}

export function limit(req: NextRequest | Request, bucket: string, capacity: number, perSecond: number): NextResponse<ApiError> | null {
  const r = rateLimit(`${bucket}:${clientIp(req)}`, capacity, perSecond);
  return r.ok ? null : apiError(429, "Too many requests", "RATE_LIMITED", { "Retry-After": String(r.retryAfterSeconds) });
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? (v as T) : null;
  } catch {
    return null;
  }
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** Wraps a handler so unexpected errors become a JSON 500 without leaking internals. */
export function handle<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    try {
      return await fn(...a);
    } catch (e) {
      const { log } = await import("./log");
      log.error("api error", { error: e instanceof Error ? e.message : String(e) });
      return apiError(500, "Internal error", "INTERNAL");
    }
  };
}
