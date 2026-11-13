/**
 * Pure builders for protective-action transactions. Each step carries everything the preview shows (contract name,
 * address, function, decoded args, value) and everything wagmi needs to simulate/send it. No I/O here.
 */
import type { Abi, Address, Hex } from "viem";
import { borrowerOperationsAbi, erc20Abi, morphoAbi } from "@/lib/chain/abis";
import { BTC_TOKEN, MORPHO, MUSD_PROTOCOL, PROTECTOR_ADDRESS } from "@/lib/chain/config";
import { protectorAbi } from "./protector-abi";
import { fmtUnits } from "@/lib/format";
import { closeCostFor, collateralToTarget, liquidationPrice, maxRepayFor, ratioAt, repayToTarget } from "@/lib/risk";
import type { MorphoParams, Position, TroveParams } from "@/lib/risk/types";

export type ActionKind = "repay" | "add-collateral" | "close" | "withdraw-collateral";

export interface PreviewArg {
  name: string;
  /** Human-readable value, e.g. "1,250.00 MUSD" or an address. */
  display: string;
  raw: string;
}

export interface TxStep {
  key: string;
  /** Plain-language label, e.g. "Approve MUSD" or "Repay MUSD". */
  label: string;
  contractName: string;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
  previewArgs: PreviewArg[];
  /** Approvals are skipped at send time if the live allowance already covers `approveAmount`. */
  approval?: { token: Address; spender: Address; amount: bigint };
  /** Skipped at send time unless this wallet has an armed rule or a budget in MezoGuardProtector. */
  protectorCleanup?: true;
}

export interface ActionPlan {
  kind: ActionKind;
  protocol: Position["protocol"];
  positionId: string;
  steps: TxStep[];
  /** Notes shown above the preview (e.g. capped repay). */
  notes: string[];
}

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export function troveParams(p: Position): TroveParams | null {
  return p.params.kind === "trove" ? p.params : null;
}
export function morphoParams(p: Position): MorphoParams | null {
  return p.params.kind === "morpho" ? p.params : null;
}

/** Largest repay that keeps the Trove open: debt − gas compensation − minimum net debt (≥ 0). */
export function troveMaxRepay(p: Position): bigint {
  return troveParams(p) ? maxRepayFor(p) : 0n;
}

/** MUSD needed to close: debt − gas compensation (the protocol burns the gas reserve itself). */
export function troveCloseCost(p: Position): bigint {
  return troveParams(p) ? closeCostFor(p) : 0n;
}

/** Nominal ICR used by SortedTroves (coll × 1e20 / principal). */
export function nominalIcr(coll: bigint, principal: bigint): bigint {
  if (principal <= 0n) return 2n ** 256n - 1n;
  return (coll * 10n ** 20n) / principal;
}

export interface Hints { upper: Address; lower: Address }
export const NO_HINTS: Hints = { upper: ZERO, lower: ZERO };

export function fmtAmount(v: bigint, decimals: number, symbol: string, maxFrac = 6): string {
  return `${fmtUnits(v, decimals, maxFrac)} ${symbol}`.trim();
}

const addrArg = (name: string, a: Address): PreviewArg => ({ name, display: a, raw: a });

export function buildTroveRepay(p: Position, amount: bigint, hints: Hints = NO_HINTS): ActionPlan {
  const max = troveMaxRepay(p);
  const notes: string[] = [];
  let amt = amount;
  if (amt > max) {
    amt = max;
    notes.push(
      `A Trove must keep at least the minimum debt, so the most you can repay without closing is ${fmtAmount(max, 18, "MUSD", 2)}.`,
    );
  }
  return {
    kind: "repay",
    protocol: p.protocol,
    positionId: p.positionId,
    notes,
    steps: [
      {
        key: "repay",
        label: "Repay MUSD",
        contractName: "BorrowerOperations",
        address: MUSD_PROTOCOL.borrowerOperations,
        abi: borrowerOperationsAbi as Abi,
        functionName: "repayMUSD",
        args: [amt, hints.upper, hints.lower],
        previewArgs: [
          { name: "_amount", display: fmtAmount(amt, 18, "MUSD", 4), raw: amt.toString() },
          addrArg("_upperHint", hints.upper),
          addrArg("_lowerHint", hints.lower),
        ],
      },
    ],
  };
}

export function buildTroveAddColl(p: Position, amount: bigint, hints: Hints = NO_HINTS): ActionPlan {
  return {
    kind: "add-collateral",
    protocol: p.protocol,
    positionId: p.positionId,
    notes: [],
    steps: [
      {
        key: "addColl",
        label: "Add BTC",
        contractName: "BorrowerOperations",
        address: MUSD_PROTOCOL.borrowerOperations,
        abi: borrowerOperationsAbi as Abi,
        functionName: "addColl",
        args: [hints.upper, hints.lower],
        value: amount,
        previewArgs: [addrArg("_upperHint", hints.upper), addrArg("_lowerHint", hints.lower)],
      },
    ],
  };
}

export function buildTroveWithdrawColl(p: Position, amount: bigint, hints: Hints = NO_HINTS): ActionPlan {
  return {
    kind: "withdraw-collateral",
    protocol: p.protocol,
    positionId: p.positionId,
    notes: [],
    steps: [
      {
        key: "withdrawColl",
        label: "Withdraw BTC",
        contractName: "BorrowerOperations",
        address: MUSD_PROTOCOL.borrowerOperations,
        abi: borrowerOperationsAbi as Abi,
        functionName: "withdrawColl",
        args: [amount, hints.upper, hints.lower],
        previewArgs: [
          { name: "_amount", display: fmtAmount(amount, 18, "BTC", 8), raw: amount.toString() },
          addrArg("_upperHint", hints.upper),
          addrArg("_lowerHint", hints.lower),
        ],
      },
    ],
  };
}

export function buildTroveClose(p: Position): ActionPlan {
  // A rule armed for this Trove would otherwise outlive it and could repay a later Trove at the same address.
  const cleanup: TxStep[] = PROTECTOR_ADDRESS
    ? [
        {
          key: "protector-revoke",
          label: "Turn off automatic repay",
          contractName: "MezoGuardProtector",
          address: PROTECTOR_ADDRESS,
          abi: protectorAbi as Abi,
          functionName: "revoke",
          args: [],
          previewArgs: [],
          protectorCleanup: true,
        },
      ]
    : [];
  return {
    kind: "close",
    protocol: p.protocol,
    positionId: p.positionId,
    notes: [
      `Closing repays ${fmtAmount(troveCloseCost(p), 18, "MUSD", 2)} from this wallet and returns all your BTC. The 200 MUSD gas reserve is cancelled by the protocol.`,
      ...(PROTECTOR_ADDRESS ? ["If automatic repay is on for this wallet, it is turned off first and its budget returned to you."] : []),
    ],
    steps: [
      ...cleanup,
      {
        key: "close",
        label: "Close Trove",
        contractName: "BorrowerOperations",
        address: MUSD_PROTOCOL.borrowerOperations,
        abi: borrowerOperationsAbi as Abi,
        functionName: "closeTrove",
        args: [],
        previewArgs: [],
      },
    ],
  };
}

export function marketParamsOf(m: MorphoParams) {
  return {
    loanToken: m.loanToken,
    collateralToken: m.collateralToken,
    oracle: m.oracle,
    irm: m.irm,
    lltv: m.lltv,
  } as const;
}

function marketArg(m: MorphoParams): PreviewArg {
  return {
    name: "marketParams",
    display: `${m.marketLabel} (LLTV ${(Number(m.lltv / 10n ** 14n) / 100).toFixed(0)}%)`,
    raw: JSON.stringify({ ...marketParamsOf(m), lltv: m.lltv.toString() }),
  };
}

/** Allowance buffer for full repay by shares: interest accrues between the read and the transaction. */
export const FULL_REPAY_BUFFER_BPS = 10n; // 0.10 %

/**
 * Morpho repay. Partial → repay by assets. Full → repay by shares (exact remaining debt), approving the current debt
 * plus a 0.10 % buffer to cover interest accrued until the block that includes the tx.
 */
export function buildMorphoRepay(
  p: Position,
  opts: { amount: bigint; full: boolean; borrowShares?: bigint },
): ActionPlan {
  const m = morphoParams(p);
  if (!m) throw new Error("Not a Morpho position");
  const sym = p.debtAsset.symbol;
  const dec = p.debtAsset.decimals;
  const full = opts.full && opts.borrowShares !== undefined && opts.borrowShares > 0n;
  const approveAmount = full ? p.debtAmount + (p.debtAmount * FULL_REPAY_BUFFER_BPS) / 10_000n + 1n : opts.amount;
  const assets = full ? 0n : opts.amount;
  const shares = full ? (opts.borrowShares as bigint) : 0n;
  return {
    kind: "repay",
    protocol: p.protocol,
    positionId: p.positionId,
    notes: full ? ["Full repay uses your exact borrow shares, so no dust is left behind."] : [],
    steps: [
      {
        key: "approve",
        label: `Approve ${sym}`,
        contractName: `${sym} token`,
        address: m.loanToken,
        abi: erc20Abi as Abi,
        functionName: "approve",
        args: [MORPHO.morpho, approveAmount],
        previewArgs: [
          addrArg("spender (Morpho)", MORPHO.morpho),
          { name: "amount", display: fmtAmount(approveAmount, dec, sym, dec), raw: approveAmount.toString() },
        ],
        approval: { token: m.loanToken, spender: MORPHO.morpho, amount: approveAmount },
      },
      {
        key: "repay",
        label: `Repay ${sym}`,
        contractName: "Morpho Blue",
        address: MORPHO.morpho,
        abi: morphoAbi as Abi,
        functionName: "repay",
        args: [marketParamsOf(m), assets, shares, p.owner, "0x" as Hex],
        previewArgs: [
          marketArg(m),
          { name: "assets", display: full ? "0 (repaying by shares)" : fmtAmount(assets, dec, sym, dec), raw: assets.toString() },
          { name: "shares", display: full ? shares.toString() : "0", raw: shares.toString() },
          addrArg("onBehalf", p.owner),
          { name: "data", display: "0x (none)", raw: "0x" },
        ],
      },
    ],
  };
}

export function buildMorphoSupplyCollateral(p: Position, amount: bigint): ActionPlan {
  const m = morphoParams(p);
  if (!m) throw new Error("Not a Morpho position");
  const sym = p.collateralAsset.symbol;
  const dec = p.collateralAsset.decimals;
  const isBtc = m.collateralToken.toLowerCase() === BTC_TOKEN.toLowerCase();
  return {
    kind: "add-collateral",
    protocol: p.protocol,
    positionId: p.positionId,
    notes: isBtc ? ["On Mezo, BTC is also an ERC-20 token, so Morpho needs an approval before it can take it."] : [],
    steps: [
      {
        key: "approve",
        label: `Approve ${sym}`,
        contractName: isBtc ? "BTC token (Mezo precompile)" : `${sym} token`,
        address: m.collateralToken,
        abi: erc20Abi as Abi,
        functionName: "approve",
        args: [MORPHO.morpho, amount],
        previewArgs: [
          addrArg("spender (Morpho)", MORPHO.morpho),
          { name: "amount", display: fmtAmount(amount, dec, sym, 8), raw: amount.toString() },
        ],
        approval: { token: m.collateralToken, spender: MORPHO.morpho, amount },
      },
      {
        key: "supplyCollateral",
        label: `Add ${sym}`,
        contractName: "Morpho Blue",
        address: MORPHO.morpho,
        abi: morphoAbi as Abi,
        functionName: "supplyCollateral",
        args: [marketParamsOf(m), amount, p.owner, "0x" as Hex],
        previewArgs: [
          marketArg(m),
          { name: "assets", display: fmtAmount(amount, dec, sym, 8), raw: amount.toString() },
          addrArg("onBehalf", p.owner),
          { name: "data", display: "0x (none)", raw: "0x" },
        ],
      },
    ],
  };
}

/** Estimated effect of an action on CR and liquidation price, using the protocol's own math (lib/risk). */
export function estimateImpact(
  p: Position,
  kind: ActionKind,
  amount: bigint,
): { ratioBefore: bigint; ratioAfter: bigint; liqBefore: bigint; liqAfter: bigint } {
  const ratioBefore = p.collateralRatio;
  const liqBefore = p.liquidationPriceUsd;
  if (amount <= 0n) return { ratioBefore, ratioAfter: ratioBefore, liqBefore, liqAfter: liqBefore };
  let coll = p.collateralAmount;
  let debt = p.debtAmount;
  if (kind === "repay") debt = debt - amount;
  else if (kind === "add-collateral") coll = coll + amount;
  else if (kind === "withdraw-collateral") coll = coll - amount;
  else return { ratioBefore, ratioAfter: 0n, liqBefore, liqAfter: 0n };
  if (debt <= 0n) return { ratioBefore, ratioAfter: 0n, liqBefore, liqAfter: 0n };
  if (coll < 0n) coll = 0n;
  const after: Position = { ...p, collateralAmount: coll, debtAmount: debt };
  return {
    ratioBefore,
    ratioAfter: ratioAt(p, coll, debt, p.price.usd),
    liqBefore,
    liqAfter: liquidationPrice(after),
  };
}

/** Amount of debt to repay to reach `target` ratio (debt-token units, ≥ 0). */
export function repayForTarget(p: Position, target: bigint): bigint {
  return repayToTarget(p, target);
}

/** Collateral to add to reach `target` ratio (collateral units, rounded up). */
export function addCollForTarget(p: Position, target: bigint): bigint {
  return collateralToTarget(p, target);
}

/** Native BTC kept back for gas when adding collateral from the wallet balance. */
export const GAS_RESERVE_WEI = 2n * 10n ** 14n; // 0.0002 BTC
