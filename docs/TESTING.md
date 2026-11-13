# Testing

| Suite | Command | Result (2026-11-09) |
|---|---|---|
| Contracts (Foundry: unit, fuzz, invariant) | `cd contracts && forge test` | 43 pass, 1 skipped (fork test, `MEZO_FORK=true`, not run) |
| Risk engine + adapters | `npx vitest run tests/risk tests/protocols` | 66 pass, 4 skipped (live, `LIVE=1`, not run) |
| Backend (PGlite in-memory, mocked chain) | `npx vitest run tests/backend` | 38 pass |
| Web components / logic (jsdom) | `npx vitest run tests/web` | 36 pass |
| Whole repo | `npx vitest run` · `npx tsc --noEmit` · `npx next build` | 140 pass · 0 errors · build OK |

## Not run yet (needs the owner's go-ahead)
- `LIVE=1 npx vitest run tests/protocols/live.test.ts` — asserts our Trove CR equals `TroveManager.getCurrentICR` for a real wallet and Morpho discovery for real borrowers.
- `MEZO_FORK=true forge test --mc ForkTest` — checks the protector's EIP-712 digest against the real BorrowerOperationsSignatures.
- `npm run worker:once` against a real tracked wallet — the controlled threshold-crossing test.
- Browser E2E of the 18-step demo (docs/DEMO_SCRIPT.md), visual/responsive QA, security review.

## What the suites cover
- **Risk:** independent expected values (1 BTC / 40k / $100k / 110% ⇒ $44,000), every risk level and the exact protocol boundaries, price up/down, repay/add-collateral recommendations incl. min-net-debt, multi-position debt-weighted portfolio, per-protocol thresholds, stale oracle, Morpho share math vs hand-computed real-market values, 6 vs 18 decimals.
- **Backend:** threshold crossing fires once, re-arm with hysteresis, cooldown, escalation, dedupe on rerun, stale-price suppression, skipped deliveries without credentials, retry/backoff, RPC failure resilience, EIP-191 sessions, on-chain verification of recorded actions.
- **Contracts:** happy path with real EIP-712 signing, trigger/expiry/executor/budget checks, replay, nonce invalidation, front-running harmlessness, reentrancy, invariants (budgets == balance, no allowances).
- **Web:** address validation, empty portfolio, failed scans never shown as "no loans", stale banner, sort/filter, simulator recompute, alert form, transaction previews, wrong-network guard, protector ABI vs compiled JSON.
