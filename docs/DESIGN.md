# MezoGuard design

A calm, professional risk terminal that an ordinary borrower understands. The reader is someone with BTC locked in a
loan, checking it on a laptop at a desk or on a phone between other things. They want one answer first ("am I safe?"),
then the numbers behind it, then what to do. Nothing on screen should compete with that.

Register: product UI (the landing page uses the same system, slightly more air). Light theme by default, dark via the
header toggle (`next-themes`, class strategy, `defaultTheme="light"`, system preference not applied).

## Principles

1. **The verdict comes first.** Every loan and the portfolio lead with the risk level, then the ratio, then the rest.
2. **Red means danger, nowhere else.** Red is reserved for critical, liquidatable, liquidation lines and destructive
   actions. Brand, links and focus use a petrol accent. Warnings (stale price, wrong network) use amber.
3. **Never present stale as live.** A late price shows a banner, the level gets "(unverified)", and the dot turns hollow.
4. **A failed read is not an empty wallet.** Per-protocol scan errors are warnings; the empty state only appears when
   every protocol was checked.
5. **Show the transaction before the wallet does.** Contract name and address, function, arguments, BTC value and gas
   are on screen before "Confirm in wallet".
6. **Plain words.** Sentence case, short sentences, no jargon where a normal word works ("ratio", "price can fall",
   "repay"). No eyebrow labels, no pills, no slogans, no em dashes.

## Tokens (`app/globals.css`)

All colours are OKLCH, defined as CSS variables on `:root` and `.dark`, mapped to Tailwind via `@theme inline`.

| Role | Token | Light | Dark | Use |
|---|---|---|---|---|
| Page | `--bg` | `oklch(1 0 0)` | `oklch(0.175 0.008 258)` | body |
| Surface | `--surface` | `0.982 0.003 258` | `0.205 0.009 258` | table heads, bands, inset boxes |
| Surface 2 | `--surface-2` | `0.962 0.005 258` | `0.235 0.01 258` | hover, segmented controls, tracks |
| Raised | `--raised` | white | `0.225 0.01 258` | panels, dialogs, inputs |
| Ink | `--ink` | `0.22 0.014 258` | `0.95 0.004 258` | primary text, primary buttons |
| Ink 2 | `--ink-2` | `0.43` | `0.77` | secondary text (≥ 7:1 on white) |
| Ink 3 | `--ink-3` | `0.52` | `0.67` | tertiary text, icons (≥ 4.5:1 on white) |
| Line | `--line` / `--line-strong` | `0.915` / `0.85` | `0.29` / `0.37` | dividers / control borders |
| Accent | `--accent`, `--accent-ink`, `--accent-soft` | petrol `0.47 0.095 226` | `0.76 0.1 226` | links, focus, slider, chart line 1 |
| Warn | `--warn-bg/line/ink` | amber | amber | stale price, wrong network |
| Danger | `--danger-bg/line/ink` | red | red | errors, failed tx, liquidation lines |

Neutrals carry a faint cool tint (hue 258, chroma ≤ 0.014). Shadows are tinted toward ink, never pure black on light.

### Risk scale

| Level | Token | Rule (default thresholds, × liquidation ratio) |
|---|---|---|
| Healthy | `--risk-healthy` (green 155) | ratio ≥ 1.6× |
| Watch | `--risk-watch` (amber 84) | < 1.6× |
| High risk | `--risk-high` (orange 52) | < 1.3× |
| Critical | `--risk-critical` (red 27) | < 1.1× |
| Liquidatable | `--risk-liquidatable` (deep red 20) + 2px halo | at or below the liquidation ratio |

`<RiskBadge>` is the only treatment: a coloured dot plus the word, with the word in `--ink`. Colour is never the only
signal, and the word carries contrast. Stale data adds a dashed outline to the dot, lowers its opacity and appends
"(unverified)". Severities in notifications use the same dots (info uses `--ink-3`).

### Radius, spacing, layers

- Radius: 4px (small tags), 6px (buttons, inputs, inset boxes), 10px (panels, dialogs), 14px (landing example card).
  Never mixed on one element type.
- Spacing on a 4px grid; panels pad 16px (mobile) / 20px; page gutter 16 / 24 / 32px; max width 1240px.
- Z-index scale: `--z-sticky` 20 (header), `--z-overlay` 40, `--z-modal` 50, `--z-toast` 60.

## Type

- Geist (UI, headings, data) and Geist Mono (addresses, hashes, function names), loaded with `next/font/google`.
- One family carries everything; hierarchy comes from size and weight.
- Scale (px): 11 / 12 / 13 / 14 (body) / 15 / 18 / 20 / 24 / 30. Landing h1 36 → 48. Detail-page ratio 48.
- Every number uses the `num` utility (tabular figures). Money and amounts are formatted only by `lib/format`.
- Headings use `text-wrap: balance`, prose `text-wrap: pretty`, prose capped at about 70ch.

## Components

| Component | File | Notes |
|---|---|---|
| Button | `components/ui/button.tsx` | primary (ink), accent, secondary (outlined), ghost, danger, link. Sizes sm/md/lg/icon. `loading` shows an inline spinner and sets `aria-busy`. 1px press. |
| Input, Select, Field | `components/ui/input.tsx` | Label above, hint or error below (`role="alert"`), `aria-invalid` turns the border red. |
| Panel | `components/ui/panel.tsx` | The single container surface. Never nested. Header = title + optional one-line description + action. |
| Callout | `components/ui/callout.tsx` | info / warn / danger, full border + tint (no side stripes). |
| Dialog / side sheet | `components/ui/dialog.tsx` | Radix Dialog. `side="right"` is the protective-action sheet (max 480px, full width on phones). |
| Tabs, Slider, Switch, Skeleton | `components/ui/*` | Radix primitives with tokens. |
| RiskBadge | `components/risk/risk-badge.tsx` | See risk scale. sizes sm/md/lg. |
| StaleBanner | `components/risk/stale-banner.tsx` | Warn callout, always above the data it qualifies. |
| TxPreview | `components/actions/tx-preview.tsx` | Numbered steps; contract name + explorer-linked address, function, args, BTC value, gas, "Already approved". |
| TxGuard | `components/actions/network-guard.tsx` | Not connected → connect; wrong network → switch (adds chain if unknown); wrong account → owner shown. |
| ConnectDialog / WalletMenu | `components/layout/connect-wallet.tsx` | EIP-6963 wallets from `useConnectors()`; no third-party modal. |
| CrPriceChart | `components/portfolio/cr-price-chart.tsx` | Recharts lines per loan, dashed red liquidation lines, "Now" and "Simulated" markers, legend under the chart. |

Charts: grid lines horizontal only, axis text 11px `--ink-3`, tooltips on `--raised`, series colours `--chart-1..4`
(accent, violet, teal, slate), animations off (data refreshes every 30 s; motion would imply change that did not happen).

## Pages

- `/` Landing: split hero with a working example loan (drag the BTC price, the ratio and level update). How it works
  is a real three-step sequence. Supported loans as a comparison table. Risk scale + alert triggers side by side.
  Key-custody facts as a definition list. One CTA intent ("Connect wallet" / "Open my portfolio").
- `/portfolio/[address]`: verdict + totals, BTC-move chart, debt by risk level, protocol split, sortable/filterable
  loan table (cards on phones), recommended actions, recent alerts, ratio history. Auto refresh 30 s with
  "Updated Xs ago" and a manual refresh.
- `/positions/[protocol]/[id]`: verdict, key numbers, adjustable target with repay / add amounts, price scenarios
  (−5/−10/−15/−20/+10 % and custom), redemption exposure (Troves), history, automatic repay (Troves), protocol details.
- `/simulator`: slider + exact price + quick moves; every loan recomputed client-side with `lib/risk.simulate`.
- `/alerts`: severity tabs, mark read, rule builder, browser notifications toggle. `/settings`: account, tracked
  wallets, channels, risk levels, permissions you have given (approvals + automation) with revoke.

## States

Every data view handles: loading (skeletons shaped like the content, shimmer disabled for reduced motion), empty
(explains why and what to do), error (plain sentence + "Try again"), stale (banner + unverified levels), partial
(protocol scan failed → warning, never "no loans"), DB disabled (503 `DB_DISABLED` → "Alerts need the server
database"), signed out (EIP-191 sign-in prompt).

Transaction flow states: idle → checking (re-read the loan from chain, chain id, owner, balance, simulate) → waiting
for wallet → pending (explorer link) → done (portfolio refreshed) or error (rejected / wrong network / reverted /
insufficient balance, each in one plain sentence, e.g. "Not enough MUSD in this wallet. You need X, you have Y.").

## Motion

`motion/react`, 150–250 ms, exponential ease-out, no bounce. Used only for state: example-loan needle (spring),
table rows entering/leaving on filter, status messages in the action sheet, dialog/sheet enter/exit. Every animated
element checks `useReducedMotion()`, and a global `prefers-reduced-motion` rule disables transitions and the shimmer.

## Accessibility

Skip link; landmark labels; visible 2px focus ring in the accent; all controls labelled; risk never by colour alone;
tables use `scope`; charts have `role="img"` + `aria-label` and a text legend; live regions for "updated" time and tx
status; 44px-ish touch targets on mobile lists; layouts designed down to 360px wide (single column, tables scroll
horizontally inside their panel, never the page).

## Copy rules

Sentence case. Short. Name the thing the user knows ("Repay", "Add BTC", "Close loan"). State units. Explain risk in
terms of the BTC price ("Price can fall 41% before liquidation"). Morpho notes say plainly that each market uses its
own oracle. Tab title stays neutral (`MezoGuard`, `Portfolio · MezoGuard`); never "on Mezo" in `<title>`.
