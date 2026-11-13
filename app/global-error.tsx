"use client";

/** Last-resort boundary: replaces the root layout, so styles are inline. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "ui-sans-serif, system-ui, sans-serif", background: "#fff", color: "#1d2129" }}>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "80px 16px" }} role="alert">
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>MezoGuard could not load</h1>
          <p style={{ color: "#555b66", fontSize: 15, lineHeight: 1.6 }}>
            Nothing was sent from your wallet. Reload the page to try again.
          </p>
          {error.digest && <p style={{ color: "#6b717c", fontSize: 12, fontFamily: "ui-monospace, monospace" }}>Reference {error.digest}</p>}
          <button
            onClick={reset}
            style={{ marginTop: 16, height: 40, padding: "0 16px", borderRadius: 6, border: 0, background: "#1d2129", color: "#fff", fontSize: 14, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
