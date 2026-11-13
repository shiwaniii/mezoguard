# Roadmap

**Now (MVP, built):** MUSD Trove + Morpho Blue discovery and risk, simulator, recommendations, alerts worker (in-app/email/Telegram/browser), user-signed protective transactions, repay-only automation contract (not deployed yet).

**Next**
1. Deploy `MezoGuardProtector`, run a keeper that calls `executeRepay` when `canExecute` is true (simulated with eth_call first).
2. Persistent Morpho event index in Postgres (`indexed_events`) so serverless discovery never needs a cold scan.
3. Morpho oracle staleness: read the underlying feeds' `updatedAt` where the oracle exposes them.
4. Add-collateral automation via `addCollWithSignature` (needs a design where BTC comes from a user-funded budget).
5. Per-user custom thresholds in the risk engine (currently app defaults), weekly portfolio risk report emails.
6. Mainnet (chain 31612) configuration once addresses are verified.

**Business (not built):** free tier (one wallet, basic alerts) → Pro (multi-wallet, Telegram/email, history reports, automation) → protocol/institutional API and embeddable risk widgets. No token.
