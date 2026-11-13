# Demo script (the brief's 18-step journey)

Wallet A = a wallet with a real Mezo testnet Trove (e.g. the owner's `deployer` 0x017FF5FB886E90f9e5ADb405D8eFddffC1162dD2, ~0.071 BTC / ~2,823 MUSD, ~186%). Wallet B = a Morpho borrower or a second Trove (open one at testnet.mezo.org, min 1,800 MUSD).

1. Open MezoGuard (`/`).
2. Connect Wallet A (switch to Mezo testnet when prompted).
3. `/portfolio/<A>` discovers the Trove (and any Morpho positions).
4. Collateral and debt shown are read from TroveManager.
5. BTC price from Mezo PriceFeed with its age.
6. CR = TroveManager.getCurrentICR.
7. Open the position page.
8. Scenarios: −20%, or drag the custom price.
9. Engine recomputes CR, level, liquidation distance.
10. Note the new level and estimated liquidation price.
11. `/alerts` → sign in → rule "CR below 250%" (above the current ~186% → this is the controlled crossing).
12. Worker (`npm run worker:once` or Render) detects the crossing on real chain data.
13. Notification appears in-app (and email/Telegram if configured; browser notification if allowed).
14. Click the alert link → position page → Recommended action.
15. Review the repay amount (capped by Mezo's 1,800 MUSD minimum net debt), before/after CR, exact tx, gas.
16. Confirm in wallet → BorrowerOperations.repayMUSD on testnet.
17. Confirmation with explorer link; action recorded after on-chain receipt check.
18. Portfolio refreshes with the lower debt from chain.

Repeat 2–18 with Wallet B. Run a second worker cycle to show no duplicate alert.

Automation (after the protector is deployed): position page → Automation → deposit MUSD budget → sign RepayMUSD → arm with a trigger above the current CR → any account calls `executeRepay(A, 0x0, 0x0)` → `ProtectionExecuted` event, debt drops, budget drops by exactly the signed amount.
