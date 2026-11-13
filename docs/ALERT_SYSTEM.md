# MezoGuard alert system

Owner: Backend. Code: `lib/server/**`, `worker/run.ts`, `app/api/**`. Tests: `tests/backend/**` (`npx vitest run tests/backend`).

## Moving parts

```
worker/run.ts (Render, every 60 s)  ─┐
/api/worker/run (Vercel cron, daily) ─┴─> runMonitorCycle()  (lib/server/monitor.ts)
        │ discoverAll / readBtcPrice / refreshPosition   (lib/protocols, live chain)
        │ assess / recommend                              (lib/risk, pure)
        ▼
 loan_positions ─ risk_snapshots ─ alert_rule_state ─ notifications ─ notification_deliveries ─ worker_heartbeats
        ▼
 channels: in_app (the row) · email (Resend) · telegram (Bot API) · browser (client polls /api/notifications)
```

The **Render background worker is the primary engine**. Vercel Hobby only allows one cron run per day, so
`vercel.json` schedules `/api/worker/run` daily at 08:00 UTC as a backstop. On Vercel Pro you can tighten it.

## One cycle (`runMonitorCycle`)

1. `worker_heartbeats` row: `last_run_started_at`, `runs += 1`, status `running`.
2. Read the Mezo BTC price (`readBtcPrice`). A throw or a stale reading marks the cycle `priceStale`.
3. Wallets = every active `tracked_wallets` row + every user's own wallet (distinct).
4. `discoverAll(wallet)` — live chain reads. Adapter errors are recorded, never treated as "no loans".
5. Upsert `loan_positions`. A previously active position missing from a protocol that scanned **OK** is re-read with
   `refreshPosition` and marked `closed` / `liquidated` / `redeemed`. Liquidations and full redemptions create a
   notification for every user with a rule on that wallet/position.
6. Insert one `risk_snapshots` row per position (`price_stale` set when the position's price or the BTC price is stale).
7. Evaluate each enabled rule for the wallet (rule `position_id` null = all the wallet's positions).
8. Insert notifications (`dedupe_key` unique → `on conflict do nothing`). The notification insert and the edge-state
   update happen in one transaction.
9. Fan out deliveries (see below), including any notification whose fan-out was interrupted in the last 24 h.
10. Heartbeat finish: `ok` (no errors) · `partial` (some errors, e.g. one adapter down) · `error` (nothing scanned,
    e.g. RPC down) · `last_error` text. The cycle never throws.

## Trigger types (`alert_rules.trigger_type` / `threshold`)

| trigger | threshold | fires when | re-arms when |
|---|---|---|---|
| `cr_below` | percent, e.g. `"200"` (100–10000) | protocol CR < threshold | CR ≥ threshold × 1.02 |
| `liquidation_price_within_pct` | percent, e.g. `"15"` (0–100) | (price − liqPrice) / price ≤ threshold | buffer ≥ threshold × 1.02 |
| `level_at_least` | `watch` \| `high` \| `critical` \| `liquidatable` | risk level ≥ threshold | level < threshold |
| `btc_drop_pct` | percent, e.g. `"10"` | the position's collateral price ≤ reference × (1 − threshold) | n/a: after each fire the reference resets to the price at the fire, so each further drop of X % is a new crossing |
| `redemption` | `moderate` \| `high` (default `high`) | (a) Trove redemption exposure ≥ threshold (edge-triggered), or (b) a **redemption event**: Trove coll AND debt both fell since the previous sync with no protective action recorded in between, or status `redeemed` | (a) exposure < threshold; (b) one-shot per block |

Notes:
- CR and levels are the protocol's own numbers from `lib/risk` (Trove: `getCurrentICR`; Morpho: its oracle).
- `btc_drop_pct` reference = the first price observed after the rule is created (≤ one interval later), then the price at
  each fire. It uses the position's own oracle price (Mezo PriceFeed for Troves, the market oracle for Morpho).
- `redemption` rules are ignored for Morpho positions (no redemptions there).
- Changing a rule's `threshold` (PATCH) clears its edge state, so the rule starts armed again.

## Edge-triggered state machine (`alert_rule_state`, per rule × position)

`armed` (true = the next crossing fires), `last_fired_at`, `last_value` = JSON `{ epoch, level, ref?, value? }`.

- **Crossing** (condition true while armed): fire unless in cooldown → `epoch += 1`, `armed = false`, `last_fired_at = now`.
- **Cooldown** (`cooldown_minutes`, default 60, counted from the last fire): a crossing inside the cooldown is suppressed
  and the rule stays armed. If the condition still holds when the cooldown ends, it fires then.
- **Still true after firing**: nothing, unless the risk level got **worse** than the level at the last fire/escalation.
  Then an `risk_escalation` notification is sent. Escalations skip the cooldown and happen once per level.
- **Clear** (condition false past the hysteresis band): `armed = true`, and the rule's open notifications get `resolved_at`.
- **Idempotency**: `dedupe_key` = `rule:{ruleId}:pos:{positionUuid}:e{epoch}` (escalation: `…:e{epoch}:esc:{level}`,
  redemption event: `…:redeemed:{block}`, stale notice: `stale:{user}:{position}:{cooldown}m:{bucket}`, closed:
  `closed:{position}:{status}:{user}`). Re-running a cycle, even with lost edge state, cannot duplicate a notification.

Severity: `healthy` → info, `watch` → watch, `high` → high, `critical`/`liquidatable` → critical. A rule fire is never
lower than `watch`. Stale notices are `info`.

## Stale prices

`PriceFeed.fetchPrice()` reverts when the oracle is older than 60 s. The adapter then marks the price `stale`.
On stale data the cycle still writes the position and a snapshot (with `price_stale = true`). It does **not** evaluate
price-dependent triggers (`cr_below`, `liquidation_price_within_pct`, `level_at_least`, `btc_drop_pct`). Instead it sends
one `data_unavailable` info notice per user and position for each cooldown window (the smallest cooldown among the
suppressed rules), in-app only. Redemption events don't depend on price, so they are still evaluated.

## Notification content

`notifications.message` is a one-line summary. `recommended_action` is text with amounts (from `recommend()`, e.g.
"Repay 512.3 MUSD or add 0.0123 BTC to reach 262.5% (estimate)"). For `cr_below`, the target is 5 % above the
user's threshold when that is higher than the default target. `payload` (jsonb) holds:

| field | format |
|---|---|
| `wallet`, `protocol`, `positionId` | checksummed address / `mezo-musd-trove`\|`morpho-blue` / protocol position id |
| `collateralRatio`, `btcPrice`, `liquidationPrice` | **raw 1e18 decimal strings** (Wire convention; format with `lib/format`) |
| `riskLevel`, `timestamp` (ISO), `link` | `${APP_URL}/positions/{protocol}/{positionId}` |
| extras (not in DTO) | `priceStale`, `headline`, `kind` (`fire`\|`escalate`\|`event`\|`stale`\|`closed`), `display` (pre-formatted strings for email/Telegram) |

Email and Telegram send a multi-line text with every field above plus the recommended action.

## Delivery

- One `notification_deliveries` row per (notification, channel), unique. `in_app` is always recorded as `sent` (the
  row is the delivery).
- `browser` → `skipped` with reason "client-side". The frontend polls `GET /api/notifications?unread=1` and raises
  browser `Notification`s itself.
- `email` (Resend `POST https://api.resend.com/emails`) needs `RESEND_API_KEY` + `ALERT_FROM_EMAIL` and the user's email.
  `telegram` (`POST https://api.telegram.org/bot<token>/sendMessage`) needs `TELEGRAM_BOT_TOKEN` and the user's chat id.
  If a credential is missing, the row is `skipped` with the reason. It is never reported as sent.
- Retries: network errors, 429 and 5xx are retried in the same cycle, up to **3 attempts** in total, with exponential
  backoff (0.5 s, 1 s). Other 4xx errors fail at once. The final status and `attempts` are stored. Error text has
  secrets redacted (the bot token never appears).
- `notifications.delivered_at` is set when every channel has a row. A crash during fan-out resumes on the next cycle, and
  channels that already have a row are not sent again.

## Worker

```
npm run worker        # loop; MONITOR_INTERVAL_SECONDS (default 60); SIGINT/SIGTERM finish the current cycle then exit
npm run worker:once   # one cycle; exit 1 if the cycle status is error/skipped
npm run db:migrate    # apply schema.sql (idempotent; the worker also applies it on start)
```
Logs are one JSON object per line (`{"ts","level","msg",…}`). Known secret values are scrubbed from every line.
`GET /api/worker/health` reports the most recently finished worker (`monitor` = Render loop, `cron` = Vercel). It is
healthy when the last finish was less than 3 × interval ago and its status is not `error` (HTTP 200, otherwise 503).

Local dev with PGlite: `MEZOGUARD_DB=pglite` stores data in `.data/pglite`. PGlite is single-process, so don't run
`npm run worker` and `next dev` against the same directory at once. Either run one cycle at a time with
`npm run worker:once` while the dev server is stopped, or call `/api/worker/run` from the dev server. Use Postgres
(`DATABASE_URL`) to run both together.

## Environment

| var | used by | notes |
|---|---|---|
| `DATABASE_URL` | app + worker | Postgres. Takes priority over PGlite. Pooler-safe (`prepare: false`). |
| `MEZOGUARD_DB=pglite`, `PGLITE_DIR` | app + worker | Local embedded Postgres (default `.data/pglite`). |
| `SESSION_SECRET` | app | ≥16 chars. Required in production; in dev a random per-process key is used. |
| `CRON_SECRET` | app | Bearer for `/api/worker/run`. Vercel Cron sends it automatically. |
| `MONITOR_INTERVAL_SECONDS` | worker + health | Default 60. |
| `APP_URL` | worker | Base for deep links (falls back to `NEXT_PUBLIC_APP_URL`, then `http://localhost:3000`). |
| `RESEND_API_KEY`, `ALERT_FROM_EMAIL` | worker | Optional email. |
| `TELEGRAM_BOT_TOKEN` | worker | Optional Telegram. |
| `NEXT_PUBLIC_MEZO_RPC_URL`, `NEXT_PUBLIC_PROTECTOR_ADDRESS` | both | From `lib/chain/config.ts`. |
| `MEZOGUARD_LOG=silent`, `MEZOGUARD_DEBUG=1` | both | Log controls. |

## API notes for the frontend

- Sign-in: `GET /api/auth/nonce?address=0x…` → `{ message }` (sets the httpOnly `mg_nonce` cookie, valid 10 min). Then
  `personal_sign(message)` and `POST /api/auth/verify { address, message, signature }`. This sets `mg_session` (httpOnly,
  SameSite=Lax, Secure in prod, 7 days). `address` on the nonce request is optional but recommended.
- `POST /api/alerts/rules` body: `{ walletAddress?, positionId?, triggerType, threshold, channels?, cooldownMinutes?, enabled? }`.
  `walletAddress` defaults to the signed-in wallet. A wallet other than your own is tracked automatically.
  `positionId` is the protocol position id (Trove borrower address, or `${marketId}:${owner}`). The DTO returns it the same way.
- `POST /api/actions` body: `{ walletAddress (or wallet), txHash, actionType (or action): repay|add_collateral|close|withdraw_collateral|automation_repay (hyphens ok), estimatedAmount?, positionId? }`.
  `estimatedAmount` is a native-units integer string. The response is 404 `RECEIPT_NOT_FOUND` until the tx is mined (retry),
  or 422 `WRONG_SENDER` / `WRONG_TARGET`.
- `/api/portfolio/[address]` is cached for 10 s per address (`X-Cache: HIT|MISS`). It is rate-limited per IP (20 burst,
  1 per 2 s) and returns 429 with `Retry-After`.
- Without a database: session, wallet, rule, notification, settings and action routes return 503 `DB_DISABLED`.
  `/api/session` returns `dbEnabled: false`.
