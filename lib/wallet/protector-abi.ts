/**
 * Typed ABI for MezoGuardProtector (frozen interface contracts/src/interfaces/IMezoGuardProtector.sol plus the
 * contract's InvalidSignature error). Human-readable so viem infers argument/return types; tests/web/protector-abi
 * checks every entry against the compiled contracts/abi/MezoGuardProtector.json.
 */
import { parseAbi } from "viem";

export const protectorAbi = parseAbi([
  "struct Rule { uint256 budget; uint256 repayAmount; uint256 triggerIcr; uint256 sigDeadline; address executor; bool armed; bytes signature; }",
  "event Deposited(address indexed borrower, uint256 amount, uint256 newBudget)",
  "event Withdrawn(address indexed borrower, uint256 amount, uint256 newBudget)",
  "event Armed(address indexed borrower, uint256 repayAmount, uint256 triggerIcr, uint256 sigDeadline, address executor)",
  "event Revoked(address indexed borrower, uint256 refunded)",
  "event Disarmed(address indexed borrower)",
  "event ProtectionExecuted(address indexed borrower, address indexed executor, uint256 repaid, uint256 icrBefore, uint256 icrAfter, uint256 price)",
  "error NotArmed()",
  "error Expired()",
  "error NotExecutor()",
  "error InsufficientBudget()",
  "error AboveTrigger(uint256 icr, uint256 trigger)",
  "error InvalidParams()",
  "error NoImprovement()",
  "error InvalidSignature()",
  "error PreviousSignatureLive()",
  "error TroveNotActive()",
  "error TroveStillActive()",
  "error RepayBelowMinNetDebt()",
  "error RepayLeavesIcrBelowMcr()",
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function arm(uint256 repayAmount, uint256 triggerIcr, uint256 sigDeadline, address executor, bytes signature)",
  "function revoke()",
  "function disarmIfClosed(address borrower)",
  "function lastSignedNonce(address borrower) view returns (uint256)",
  "function lastSignedDeadline(address borrower) view returns (uint256)",
  "function armedNonce(address borrower) view returns (uint256)",
  "function borrowerOperations() view returns (address)",
  "function executeRepay(address borrower, address upperHint, address lowerHint)",
  "function ruleOf(address borrower) view returns (Rule)",
  "function canExecute(address borrower) view returns (bool ready, uint256 icr, string reason)",
  "function musd() view returns (address)",
  "function troveManager() view returns (address)",
  "function priceFeed() view returns (address)",
  "function borrowerOperationsSignatures() view returns (address)",
  "function MIN_TRIGGER_ICR() view returns (uint256)",
  "function MAX_TRIGGER_ICR() view returns (uint256)",
  "function MAX_SIG_DURATION() view returns (uint256)",
]);

export interface ProtectorRule {
  budget: bigint;
  repayAmount: bigint;
  triggerIcr: bigint;
  sigDeadline: bigint;
  executor: `0x${string}`;
  armed: boolean;
  signature: `0x${string}`;
}
