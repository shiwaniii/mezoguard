import { ImageResponse } from "next/og";

export const alt = "MezoGuard: monitor your Bitcoin-backed loans";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LEVELS = [
  { label: "Healthy", color: "#2f9e62" },
  { label: "Watch", color: "#d9a520" },
  { label: "High risk", color: "#e07a2c" },
  { label: "Critical", color: "#d23c33" },
  { label: "Liquidatable", color: "#8f1f1f" },
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#ffffff", padding: "72px 80px", color: "#1d2129", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="64" height="64" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="8" fill="#1d2129" />
            <path d="M8 20a8 8 0 0 1 16 0" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M16 20l4.5-5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="16" cy="20" r="1.9" fill="#fff" />
          </svg>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>MezoGuard</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 68, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05, maxWidth: 980 }}>
            See how close your Bitcoin loans are to liquidation.
          </div>
          <div style={{ fontSize: 28, color: "#555b66", maxWidth: 940, lineHeight: 1.4 }}>
            MUSD Troves and Morpho Blue markets, read live from the chain.
          </div>
        </div>
        <div style={{ display: "flex", gap: 36, fontSize: 24, color: "#1d2129" }}>
          {LEVELS.map((l) => (
            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 14, height: 14, borderRadius: 7, background: l.color }} />
              {l.label}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
