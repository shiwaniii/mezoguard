/**
 * Browser-side SortedTroves hints (HintHelpers.getApproxHint → SortedTroves.findInsertPosition), mirroring
 * lib/protocols/mezo-trove getHints without importing server code. Wrong hints only cost gas; on any failure we fall
 * back to zero hints, which the protocol accepts.
 */
import type { PublicClient } from "viem";
import { hintHelpersAbi, sortedTrovesAbi } from "@/lib/chain/abis";
import { MUSD_PROTOCOL } from "@/lib/chain/config";
import { NO_HINTS, nominalIcr, type Hints } from "./plans";

export async function fetchTroveHints(client: PublicClient, coll: bigint, principal: bigint): Promise<Hints> {
  try {
    const nicr = nominalIcr(coll, principal);
    const size = await client.readContract({ address: MUSD_PROTOCOL.sortedTroves, abi: sortedTrovesAbi, functionName: "getSize" });
    const trials = BigInt(Math.min(Math.ceil(15 * Math.sqrt(Number(size || 1n))), 1500));
    const [approx] = await client.readContract({
      address: MUSD_PROTOCOL.hintHelpers,
      abi: hintHelpersAbi,
      functionName: "getApproxHint",
      args: [nicr, trials, BigInt(Math.floor(Math.random() * 1e9))],
    });
    const [upper, lower] = await client.readContract({
      address: MUSD_PROTOCOL.sortedTroves,
      abi: sortedTrovesAbi,
      functionName: "findInsertPosition",
      args: [nicr, approx, approx],
    });
    return { upper, lower };
  } catch {
    return NO_HINTS;
  }
}
