import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const description =
  "Monitor every supported Mezo loan, understand your liquidation exposure, and take action before your collateral is at risk.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  // Neutral tab title on purpose: wallets have flagged "… on Mezo" titles as phishing.
  title: { default: "MezoGuard", template: "%s · MezoGuard" },
  description,
  applicationName: "MezoGuard",
  openGraph: { type: "website", siteName: "MezoGuard", title: "MezoGuard", description, url: siteUrl },
  twitter: { card: "summary_large_image", title: "MezoGuard", description },
  robots: { index: true, follow: true },
  formatDetection: { telephone: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#16181d" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh">
        <Providers>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[var(--z-toast)] focus:rounded-md focus:bg-raised focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
          >
            Skip to content
          </a>
          <SiteHeader />
          <main id="main" className="min-h-[60dvh]">
            {children}
          </main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
