"use client";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { ThemeProvider, useTheme } from "next-themes";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { Toaster } from "sonner";
import { wagmiConfig } from "@/lib/wallet/config";
import { mezoTestnet } from "@/lib/chain/config";
import { NotificationPoller } from "@/components/alerts/notification-poller";

// Passport's wallet modal, matched to MezoGuard's ink primary and small radii.
const rkLight = lightTheme({ accentColor: "#1b1f27", accentColorForeground: "#ffffff", borderRadius: "small", fontStack: "system" });
const rkDark = darkTheme({ accentColor: "#eceef1", accentColorForeground: "#16181d", borderRadius: "small", fontStack: "system" });

function WalletModalProvider({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <RainbowKitProvider theme={resolvedTheme === "dark" ? rkDark : rkLight} initialChain={mezoTestnet} modalSize="compact" appInfo={{ appName: "MezoGuard" }}>
      {children}
    </RainbowKitProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true },
        },
      }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <WagmiProvider config={wagmiConfig} reconnectOnMount>
        <QueryClientProvider client={queryClient}>
          <WalletModalProvider>
            {children}
            <NotificationPoller />
            <Toaster position="bottom-right" closeButton toastOptions={{ className: "!rounded-lg !border-line !bg-raised !text-ink" }} />
          </WalletModalProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  );
}
