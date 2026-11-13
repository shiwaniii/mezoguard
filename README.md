# MezoGuard

Your Bitcoin-backed loans. One dashboard. No surprises.

**Live:** https://mezoguard.vercel.app · **Contract:** [MezoGuardProtector on Mezo testnet](https://explorer.test.mezo.org/address/0xA405907C5786bC93451A5F43FA9EdE379a80cB95?tab=contract) · **Repo:** https://github.com/shiwaniii/mezoguard

MezoGuard finds every supported loan a wallet has on Mezo testnet, shows how close each one is to liquidation (and, for MUSD Troves, to redemption), lets you test BTC price moves, alerts you when a threshold is crossed, and prepares the exact repay or add-collateral transaction for you to sign.

## Supported protocols
| Protocol | Discovery | Risk | Actions |
|---|---|---|---|
| Mezo MUSD Troves | `TroveManager.getTroveStatus` (one Trove per address) | `getCurrentICR` vs MCR 110%, recovery mode, redemption queue position | repay, add BTC, close, withdraw BTC; repay-only automation |
| Morpho Blue on Mezo (BTC/mUSDC, BTC/MUSD, MUSD/mUSDC) | Borrow/SupplyCollateral events reconciled with `position()` | collateral × oracle vs LLTV 77%, interest accrued with Morpho's math | repay, add collateral |

## Run locally
```bash
npm install
cp .env.example .env.local
npm run dev          # http://localhost:3000
npm run worker:once  # one monitoring cycle
```
Tests: `npx vitest run`, `cd contracts && forge test`. See docs/TESTING.md.

## What is real, simulated, or not yet supported
| Feature | Status |
|---|---|
| Wallet connect via **Mezo Passport** (Bitcoin wallets: Unisat, OKX, Xverse via a Mezo smart account; Ethereum wallets: MetaMask, Rabby, browser) and read-only address lookup | Built; Passport sign-in verified by tests and against the live OrangeKit factory, not yet with a real Bitcoin wallet |
| MUSD Trove discovery, collateral/debt/ICR, liquidation price, redemption exposure | Fully functional, read from chain |
| Morpho Blue discovery and health | Fully functional, read from chain; loan assets valued at $1; no oracle staleness signal |
| BTC price | Real Mezo PriceFeed; stale (>60 s) flagged, never shown as live |
| Risk levels, simulator, repay/add-collateral recommendations | Functional; recommendations are estimates, the transaction preview is exact |
| Alerts worker, in-app + browser notifications | Built and unit-tested; live run not yet done |
| Email / Telegram | Built; need `RESEND_API_KEY` / `TELEGRAM_BOT_TOKEN` |
| Protective transactions (user-signed) | Built; no real testnet tx executed yet |
| Repay automation (`MezoGuardProtector`) | Deployed and source-verified on testnet at [`0xA405…cB95`](https://explorer.test.mezo.org/address/0xA405907C5786bC93451A5F43FA9EdE379a80cB95). Live run: a keeper wallet ran `executeRepay` through the real Mezo contracts ([tx](https://explorer.test.mezo.org/tx/0x3361126e400d35c4a3cc07d5a6ec5b41c28900f916c59cac5a920632a3153bf7)). Ethereum wallets only: Mezo's signed repay checks ECDSA, which Passport smart accounts can't produce |
| Simulated data | Only the simulator's hypothetical prices. No mock positions anywhere. |
| Deployment | Web app live at https://mezoguard.vercel.app (Vercel, Supabase Postgres in schema `mezoguard`). The always-on alert worker (Render) is not hosted yet; Vercel cron runs one cycle a day |

## Docs
TECHNICAL_DISCOVERY · ARCHITECTURE · MEZO_INTEGRATION · RISK_ENGINE · ALERT_SYSTEM · SECURITY · TESTING · DEPLOYMENT · DEMO_SCRIPT · ROADMAP · DESIGN (all in `docs/`).
