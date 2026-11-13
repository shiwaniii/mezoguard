/**
 * MezoGuard's own testnet deployment (contracts/deployments/31611.json). Shown in the site footer.
 * Source verified on the Mezo explorer. The live run is the end-to-end check from 2026-11-12: a keeper wallet ran
 * executeRepay through the real Mezo BorrowerOperationsSignatures.
 */
import type { Hex } from "viem";
import { EXPLORER_URL } from "./config";

export const DEPLOYMENT = {
  protector: "0xA405907C5786bC93451A5F43FA9EdE379a80cB95",
  deployBlock: 16_734_446,
  deployTx: "0x0b8e90a423bda2a9cf432dfd2f4f0db9bce48bc3bf1dad85bd9389d33d6eb3ae" as Hex,
  armTx: "0x8885c90c6f8040e8e850cd6ab4d337feae2737faef9530867c436abdc9d22b58" as Hex,
  protectionExecutedTx: "0x3361126e400d35c4a3cc07d5a6ec5b41c28900f916c59cac5a920632a3153bf7" as Hex,
} as const;

export const DEPLOYMENT_LINKS = [
  { label: "MezoGuardProtector (verified)", href: `${EXPLORER_URL}/address/${DEPLOYMENT.protector}?tab=contract` },
  { label: "Deploy tx", href: `${EXPLORER_URL}/tx/${DEPLOYMENT.deployTx}` },
  { label: "Live automated repay", href: `${EXPLORER_URL}/tx/${DEPLOYMENT.protectionExecutedTx}` },
] as const;
