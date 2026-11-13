/**
 * Runtime guard for server modules. (`import "server-only"` can't be used here: these modules also run in the
 * plain-Node worker and in vitest, where that package throws by design.) Secrets are read only from non-NEXT_PUBLIC
 * env vars, which Next never inlines into client bundles.
 */
if (typeof window !== "undefined") {
  throw new Error("lib/server/* is server-only and must not be imported from client components");
}
export {};
