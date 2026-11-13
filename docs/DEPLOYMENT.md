# Deployment

**Status (2026-11-09): nothing is deployed yet.** Code builds and unit tests pass. Each step below lists what it waits on.

## Chain configuration (verified)
- Mezo testnet, chain 31611, RPC `https://rpc.test.mezo.org`, explorer `https://explorer.test.mezo.org`.
- Protocol addresses: `lib/chain/config.ts` (sources in docs/TECHNICAL_DISCOVERY.md). MezoGuard reads and calls the existing MUSD and Morpho Blue contracts; it does not redeploy them.
- Oracles: Mezo `PriceFeed` 0x86bC…9366 (wraps BTC/USD precompile 0x7b7c…0015, 60 s staleness) for Troves; each Morpho market's own oracle for Morpho positions.

## 1. Contract — MezoGuardProtector (waits on: a funded deployer key)
```bash
cd contracts
DEPLOYER_PRIVATE_KEY=0x… forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast --skip-simulation --legacy
```
Writes `contracts/deployments/31611.json`. Set `NEXT_PUBLIC_PROTECTOR_ADDRESS` to the address. The script refuses other chains and addresses without code.

## 2. Database (waits on: a Postgres URL — Supabase or Neon)
Set `DATABASE_URL`, then `npm run db:migrate` (the worker also migrates on start).

## 3. Frontend + API on Vercel (waits on: Vercel account/project)
Root = repo root. Env: `DATABASE_URL`, `SESSION_SECRET`, `CRON_SECRET`, `APP_URL`, `NEXT_PUBLIC_PROTECTOR_ADDRESS`, optional `RESEND_API_KEY`, `ALERT_FROM_EMAIL`, `TELEGRAM_BOT_TOKEN`. `vercel.json` has a daily cron to `/api/worker/run` (Hobby limit) — the Render worker is the real-time engine.

## 4. Worker on Render (waits on: Render account)
`render.yaml` defines a background worker: `npm ci --include=dev && npm run worker` (60 s cycle, heartbeat at `/api/worker/health`). Same env as Vercel (DB + notification creds + `APP_URL`).

## 5. Local
```bash
cp .env.example .env.local     # MEZOGUARD_DB=pglite
npm run dev                    # http://localhost:3000
npm run worker:once            # one monitor cycle (don't run concurrently with dev on the same PGlite dir)
```

## Deployed services / transaction hashes
| Item | Value |
|---|---|
| Frontend URL | — (not deployed) |
| Worker | — (not deployed) |
| MezoGuardProtector | — (not deployed) |
| Demo repay tx | — (not executed) |

## Known limitations
See README "What is real".
