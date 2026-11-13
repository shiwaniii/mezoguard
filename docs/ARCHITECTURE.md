# MezoGuard — Architecture (FROZEN contracts between modules)

MezoGuard is a read-mostly risk platform. The chain is the source of truth; the DB stores tracking, alert rules,
snapshots and notifications. One custom contract (`MezoGuardProtector`) exists only because it adds a real security
property: repay-only, budget-capped, trigger-gated automation enforced on-chain.

```
Browser (Next.js app, wagmi/viem)
  ├─ reads portfolio via /api/portfolio/[address]  (server reads chain live; works with NO database)
  ├─ signs txs directly to Mezo contracts (BorrowerOperations, Morpho, MezoGuardProtector)
  └─ signs EIP-712 RepayMUSD for automation, EIP-191 login message for alert settings
Next.js API (app/api/**)  ── lib/protocols (adapters) ── lib/risk (pure engine) ── viem → rpc.test.mezo.org
Worker (worker/run.ts, long-running on Render; also /api/worker/run for Vercel cron)
  └─ tracked wallets → discover → snapshot → threshold-crossing → notifications → channels
Postgres (Supabase/Neon in prod, PGlite file .data/pglite locally) — lib/server/db/schema.sql
Mezo testnet 31611: MUSD protocol, BorrowerOperationsSignatures, Morpho Blue, MezoGuardProtector
```

## Frozen files (change only via the architect)
- `lib/chain/config.ts` — chain + every verified address.
- `lib/chain/abis.ts` — ABIs.
- `lib/risk/types.ts` — `Position` read model, risk outputs, `ProtocolAdapter`.
- `lib/api-types.ts` — HTTP JSON shapes.
- `lib/server/db/schema.sql` — DB schema.
- `contracts/src/interfaces/IMezoGuardProtector.sol` — protector interface.

## Frozen module signatures

### `lib/protocols/index.ts` (owner: Integration & Risk agent)
```ts
export function getPublicClient(): PublicClient;               // viem client for mezoTestnet with retry/backoff + multicall batching
export const adapters: ProtocolAdapter[];                        // [mezoTroveAdapter, morphoMarketAdapter]
export function discoverAll(owner: Address): Promise<{ positions: Position[]; protocols: ProtocolStatus[] }>; // never throws; per-adapter errors → status "error"
export function readBtcPrice(): Promise<PriceReading>;           // Mezo PriceFeed (60 s staleness rule) with oracle precompile updatedAt
export function refreshPosition(protocol: ProtocolId, positionId: string): Promise<Position | null>;
```
`lib/protocols/mezo-trove.ts` also exports pure helpers used by the UI tx forms:
```ts
export function maxRepay(p: Position): bigint;          // debt - gasComp - minNetDebt, ≥ 0
export function closeCost(p: Position): bigint;         // debt - gasComp
export function getHints(client, coll: bigint, debt: bigint): Promise<{ upper: Address; lower: Address }>; // HintHelpers + SortedTroves
```

### `lib/risk/index.ts` (owner: Integration & Risk agent) — pure, bigint only, no I/O
```ts
export const DEFAULT_THRESHOLDS: RiskThresholds;                 // watch 1.60, high 1.30, critical 1.10 (× liquidationRatio)
export const DEFAULT_TARGET_MULTIPLIER: bigint;                  // target ratio for recommendations = liquidationRatio × 1.6
export function assess(p: Position, t?: RiskThresholds): RiskAssessment;
export function simulate(p: Position, priceUsd: bigint, adapter: ProtocolAdapter, t?: RiskThresholds, targetRatio?: bigint): ScenarioResult;
export function recommend(p: Position, targetRatio?: bigint): Recommendation;
export function summarize(owner: Address, ps: Position[], t?: RiskThresholds): PortfolioSummary;
export function liquidationPrice(p: Position): bigint;
export function crCurve(p: Position, adapter: ProtocolAdapter, fromUsd: bigint, toUsd: bigint, steps: number): { priceUsd: bigint; ratio: bigint }[];
export function riskScore(a: RiskAssessment, p: Position): number;   // 0..100 integer
```
`lib/risk/serialize.ts`: `toWire<T>(x: T): Wire<T>`, `fromWirePosition(w): Position`, etc.
`lib/format/index.ts`: `fmtUnits(v: bigint, decimals: number, maxFrac?: number)`, `fmtUsd(v1e18)`, `fmtRatio(v1e18)` ("186.2%"), `fmtPct(frac1e18)`, `parseUnitsSafe(str, decimals): bigint | null`. Only place bigint → string for display.

### `lib/server/**` (owner: Backend agent)
- `lib/server/db/index.ts`: `getDb(): Db | null` — Postgres via `DATABASE_URL` (postgres.js) or PGlite at `PGLITE_DIR` (default `.data/pglite`) when `DATABASE_URL` unset and `MEZOGUARD_DB=pglite`; `null` → DB features disabled, app still works read-only.
- `lib/server/session.ts`: EIP-191 login (`MezoGuard sign-in` message with nonce + expiry, verified with viem `verifyMessage`), HMAC cookie with `SESSION_SECRET`.
- `lib/server/monitor.ts`: `runMonitorCycle(opts): Promise<CycleReport>` — the 10 steps of brief §7.3.
- `lib/server/alerts.ts`: rule evaluation with edge-triggered `alert_rule_state` + cooldown + `dedupe_key`.
- `lib/server/notify/{email,telegram,inapp}.ts`: email via Resend HTTP API (`RESEND_API_KEY`, `ALERT_FROM_EMAIL`), Telegram via Bot API (`TELEGRAM_BOT_TOKEN`). Missing creds → delivery row `skipped` with reason (never pretend "sent").
- `worker/run.ts`: loop every `MONITOR_INTERVAL_SECONDS` (default 60) with heartbeat; `--once` for one cycle.

### HTTP API (owner: Backend agent; consumer: Frontend agent)
| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | /api/portfolio/[address] | none | PortfolioResponse (live chain read; `?thresholds` not supported, defaults) |
| GET | /api/positions/[protocol]/[id] | none | PositionDetailResponse |
| GET | /api/price | none | Wire<PriceReading> |
| GET | /api/auth/nonce | none | { message } |
| POST | /api/auth/verify | none | SessionResponse (sets cookie) `{address, message, signature}` |
| POST | /api/auth/logout | session | SessionResponse |
| GET | /api/session | none | SessionResponse |
| GET/POST | /api/wallets | session | TrackedWalletDTO[] / TrackedWalletDTO `{walletAddress, label}` |
| PATCH/DELETE | /api/wallets/[id] | session | TrackedWalletDTO / {ok} |
| GET/POST | /api/alerts/rules | session | AlertRuleDTO[] / AlertRuleDTO |
| PATCH/DELETE | /api/alerts/rules/[id] | session | AlertRuleDTO / {ok} |
| GET | /api/notifications | session | NotificationDTO[] (`?unread=1`) |
| POST | /api/notifications/[id]/read | session | {ok} |
| GET/PUT | /api/settings | session | SettingsDTO |
| POST | /api/actions | none (tx hash verified on-chain: from == wallet, to ∈ allowlist) | {ok} |
| GET | /api/worker/health | none | WorkerHealthDTO |
| POST/GET | /api/worker/run | `Authorization: Bearer CRON_SECRET` | CycleReport |

DB disabled → session/alert/wallet routes return 503 `{error, code:"DB_DISABLED"}`; UI shows "Alerts need the server database" state.

### Contracts (owner: Solidity agent)
`contracts/src/MezoGuardProtector.sol` implements `IMezoGuardProtector`. Foundry, solc 0.8.28, evm london, OZ 5 vendored.
Constructor(musd, troveManager, priceFeed, borrowerOperationsSignatures). Deployed by `contracts/script/Deploy.s.sol`
(`--skip-simulation --legacy`; the price precompile can't be simulated locally).

## Ownership (directories are disjoint)
| Agent | Owns |
|---|---|
| Architect (main session) | frozen files above, docs/TECHNICAL_DISCOVERY.md, docs/ARCHITECTURE.md, README, DEPLOYMENT, DEMO_SCRIPT, ROADMAP, merge |
| Integration & Risk | lib/protocols/**, lib/risk/** (not types.ts), lib/format/**, tests/risk/**, tests/protocols/**, docs/MEZO_INTEGRATION.md, docs/RISK_ENGINE.md |
| Backend | lib/server/**, worker/**, app/api/**, tests/backend/**, docs/ALERT_SYSTEM.md, render.yaml, vercel.json |
| Frontend + UX | app/** except app/api, components/**, hooks/**, lib/wallet/**, public/**, tests/web/**, docs/DESIGN.md |
| Solidity | contracts/**, docs/SECURITY.md (contract + automation sections) |

## Units
- Collateral BTC: 18 dec. MUSD: 18 dec. mUSDC: 6 dec. USD values and ratios: 1e18.
- Trove CR = `TroveManager.getCurrentICR(borrower, PriceFeed.fetchPrice())` (includes pending redistribution + accrued interest).
- Morpho CR = `collateral × oraclePrice / 1e36 / borrowAssets` (borrowAssets = shares→assets rounded UP with virtual shares 1e6 / virtual assets 1, interest accrued to now with IRM borrowRateView). Liquidatable iff `borrowAssets > collateral × price / 1e36 × lltv / 1e18`.
- USD for Morpho loan assets: mUSDC and MUSD valued at $1 (stated assumption, shown in UI); collateral USD = collateral × Mezo BTC price for BTC, or ×$1 for MUSD collateral. Risk uses the Morpho oracle (what liquidations use), not USD.
