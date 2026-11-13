/** Pure sort / filter for the position list (tested in tests/web). */
import { RISK_ORDER, type Position, type ProtocolId, type RiskAssessment, type RiskLevel } from "@/lib/risk/types";

export type SortKey = "risk" | "lowest-cr" | "largest-debt" | "largest-collateral" | "protocol";

export const SORT_LABEL: Record<SortKey, string> = {
  risk: "Highest risk",
  "lowest-cr": "Lowest ratio",
  "largest-debt": "Largest debt",
  "largest-collateral": "Largest collateral",
  protocol: "Protocol",
};

export interface PositionFilter {
  protocol: ProtocolId | "all";
  asset: string | "all";
  risk: RiskLevel | "all";
}

export const NO_FILTER: PositionFilter = { protocol: "all", asset: "all", risk: "all" };

export interface Row {
  position: Position;
  assessment?: RiskAssessment;
}

const cmpBig = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
/** Ratio distance above liquidation, normalised so different protocols compare fairly. */
const headroom = (p: Position) => (p.liquidationRatio === 0n ? p.collateralRatio : (p.collateralRatio * 10n ** 18n) / p.liquidationRatio);

export function sortRows(rows: Row[], key: SortKey): Row[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (key) {
      case "risk": {
        const la = RISK_ORDER[a.assessment?.level ?? "healthy"];
        const lb = RISK_ORDER[b.assessment?.level ?? "healthy"];
        if (la !== lb) return lb - la;
        return cmpBig(headroom(a.position), headroom(b.position));
      }
      case "lowest-cr":
        return cmpBig(a.position.collateralRatio, b.position.collateralRatio);
      case "largest-debt":
        return cmpBig(b.position.debtValueUsd, a.position.debtValueUsd);
      case "largest-collateral":
        return cmpBig(b.position.collateralValueUsd, a.position.collateralValueUsd);
      case "protocol":
        return a.position.protocol.localeCompare(b.position.protocol) || cmpBig(headroom(a.position), headroom(b.position));
    }
  });
  return out;
}

export function filterRows(rows: Row[], f: PositionFilter): Row[] {
  return rows.filter(
    (r) =>
      (f.protocol === "all" || r.position.protocol === f.protocol) &&
      (f.asset === "all" || r.position.collateralAsset.symbol === f.asset || r.position.debtAsset.symbol === f.asset) &&
      (f.risk === "all" || (r.assessment?.level ?? "healthy") === f.risk),
  );
}

export function assetsIn(rows: Row[]): string[] {
  const s = new Set<string>();
  for (const r of rows) {
    s.add(r.position.collateralAsset.symbol);
    s.add(r.position.debtAsset.symbol);
  }
  return [...s].sort();
}

/** Human name for a position: "MUSD Trove" or the Morpho market label. */
export function positionName(p: Position): string {
  if (p.params.kind === "morpho") return `Morpho ${p.params.marketLabel}`;
  return "MUSD Trove";
}
