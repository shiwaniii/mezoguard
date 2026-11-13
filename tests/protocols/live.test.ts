/**
 * LIVE chain checks against rpc.test.mezo.org. Skipped unless LIVE=1:
 *   LIVE=1 npx vitest run tests/protocols/live.test.ts
 */
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { MORPHO_MARKETS, MUSD_PROTOCOL } from "@/lib/chain/config";
import { troveManagerAbi } from "@/lib/chain/abis";
import { discoverAll, getPublicClient, readBtcPrice } from "@/lib/protocols";
import { readTroveRaw, mezoTroveAdapter, getHints } from "@/lib/protocols/mezo-trove";
import { createMorphoMarketAdapter, getIndexSnapshot, morphoWarnings } from "@/lib/protocols/morpho";
import { assess, recommend } from "@/lib/risk";
import { fmtRatio, fmtUnits, fmtUsd } from "@/lib/format";

const LIVE = process.env.LIVE === "1";
const TROVE_OWNER = "0x017FF5FB886E90f9e5ADb405D8eFddffC1162dD2" as Address;
const MORPHO_BORROWERS = [
  "0x09aB514B6974601967E7b379478EFf4073cceD06",
  "0xD13FBa88f51832840174b5fBfA58B54CDad76c67",
] as Address[];

describe.skipIf(!LIVE)("LIVE Mezo testnet", () => {
  it("BTC price", async () => {
    const p = await readBtcPrice();
    console.log("BTC", fmtUsd(p.usd), p.source, "stale:", p.stale, p.staleReason ?? "", "updatedAt", p.updatedAt, "block", p.blockNumber);
    expect(p.usd).toBeGreaterThan(0n);
  }, 30_000);

  it("Trove: our CR (coll × price / (principal + interest)) == TroveManager.getCurrentICR in the same block", async () => {
    const client = getPublicClient();
    const price = await readBtcPrice();
    const raw = await readTroveRaw(client, TROVE_OWNER, price.usd); // one multicall ⇒ one block
    const ours = (raw.coll * price.usd) / (raw.principal + raw.interest);
    console.log("Trove", {
      coll: fmtUnits(raw.coll, 18, 6), principal: fmtUnits(raw.principal, 18), interest: fmtUnits(raw.interest, 18, 6),
      pending: [raw.pendingCollateral, raw.pendingPrincipal, raw.pendingInterest].map(String),
      icr: raw.icr.toString(), ours: ours.toString(), block: raw.blockNumber.toString(),
    });
    expect(raw.statusCode).toBe(1);
    expect(ours).toBe(raw.icr);

    const ps = await mezoTroveAdapter.discover(TROVE_OWNER);
    expect(ps).toHaveLength(1);
    const p = ps[0];
    const a = assess(p);
    const r = recommend(p);
    console.log("Trove position", {
      CR: fmtRatio(p.collateralRatio), MCR: fmtRatio(p.liquidationRatio), liq: fmtUsd(p.liquidationPriceUsd),
      level: a.level, redemption: p.redemption && { ...p.redemption, debtAhead: fmtUnits(p.redemption.debtAhead, 18, 0), debtAheadShare: p.redemption.debtAheadShare.toString() },
      repay: fmtUnits(r.repayAmount, 18, 2), feasible: r.repayFeasible, addColl: fmtUnits(r.addCollateral, 18, 6),
    });
    // Re-check getCurrentICR at the position's own block and price.
    const icrAtBlock = await client.readContract({
      address: MUSD_PROTOCOL.troveManager, abi: troveManagerAbi, functionName: "getCurrentICR",
      args: [TROVE_OWNER, p.price.usd], blockNumber: p.blockNumber,
    });
    expect(p.collateralRatio).toBe(icrAtBlock);
    expect(p.redemption?.queueSize).toBeGreaterThan(0);

    const hints = await getHints(client, raw.coll, raw.principal);
    console.log("hints", hints);
    expect(hints.upper).toMatch(/^0x[0-9a-fA-F]{40}$/);
  }, 120_000);

  it("Morpho discovery for real borrowers (Blockscout + full RPC log index)", async () => {
    const adapter = createMorphoMarketAdapter(getPublicClient, { waitForRpcIndex: true, concurrency: 12 });
    const t0 = Date.now();
    for (const owner of MORPHO_BORROWERS) {
      const ps = await adapter.discover(owner);
      console.log(owner, `${Date.now() - t0} ms`, ps.map((p) => ({
        market: p.params.kind === "morpho" ? p.params.marketLabel : "",
        coll: fmtUnits(p.collateralAmount, p.collateralAsset.decimals, 6),
        debt: `${fmtUnits(p.debtAmount, p.debtAsset.decimals, 6)} ${p.debtAsset.symbol}`,
        CR: fmtRatio(p.collateralRatio), liqRatio: fmtRatio(p.liquidationRatio), liqPrice: fmtUsd(p.liquidationPriceUsd),
        oracleUsd: fmtUsd(p.price.usd), level: assess(p).level,
      })));
      expect(ps.length).toBeGreaterThan(0);
      for (const p of ps) {
        expect(p.debtAmount > 0n || p.collateralAmount > 0n).toBe(true);
        const again = await adapter.refresh(p.positionId);
        expect(again?.collateralAmount).toBe(p.collateralAmount);
      }
    }
    const idx = getIndexSnapshot();
    console.log("index", { ...idx, cursor: idx.cursor.toString() }, "warnings", morphoWarnings);
    expect(idx.fullScanDone).toBe(true);
    for (const m of MORPHO_MARKETS) expect(idx.markets).toContain(m.id.toLowerCase());
  }, 600_000);

  it("discoverAll never throws and reports both protocols", async () => {
    const r = await discoverAll(MORPHO_BORROWERS[0]);
    console.log(r.protocols);
    expect(r.protocols.map((p) => p.id)).toEqual(["mezo-musd-trove", "morpho-blue"]);
  }, 600_000);
});
