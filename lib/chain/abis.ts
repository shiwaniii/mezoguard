/** FROZEN — minimal ABIs for the functions MezoGuard calls. Signatures checked against deployed implementation bytecode. */
import { parseAbi } from "viem";

export const borrowerOperationsAbi = parseAbi([
  "function repayMUSD(uint256 _amount, address _upperHint, address _lowerHint)",
  "function addColl(address _upperHint, address _lowerHint) payable",
  "function withdrawColl(uint256 _amount, address _upperHint, address _lowerHint)",
  "function withdrawMUSD(uint256 _amount, address _upperHint, address _lowerHint)",
  "function adjustTrove(uint256 _collWithdrawal, uint256 _debtChange, bool _isDebtIncrease, address _upperHint, address _lowerHint) payable",
  "function closeTrove()",
  "function minNetDebt() view returns (uint256)",
  "function borrowingRate() view returns (uint256)",
  "function redemptionRate() view returns (uint256)",
  "function MUSD_GAS_COMPENSATION() view returns (uint256)",
  "function MCR() view returns (uint256)",
  "function CCR() view returns (uint256)",
]);

export const borrowerOperationsSignaturesAbi = parseAbi([
  "function getNonce(address user) view returns (uint256)",
  "function repayMUSDWithSignature(uint256 _amount, address _upperHint, address _lowerHint, address _borrower, bytes _signature, uint256 _deadline)",
  "function addCollWithSignature(address _upperHint, address _lowerHint, address _borrower, bytes _signature, uint256 _deadline) payable",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
]);

/** EIP-712 typed data for RepayMUSD on BorrowerOperationsSignatures (domain name "BorrowerOperationsSignatures", version "1"). */
export const REPAY_MUSD_TYPES = {
  RepayMUSD: [
    { name: "amount", type: "uint256" },
    { name: "borrower", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const troveManagerAbi = parseAbi([
  "function getTroveStatus(address) view returns (uint8)",
  "function getEntireDebtAndColl(address) view returns (uint256 coll, uint256 principal, uint256 interest, uint256 pendingCollateral, uint256 pendingPrincipal, uint256 pendingInterest)",
  "function getCurrentICR(address _borrower, uint256 _price) view returns (uint256)",
  "function getNominalICR(address _borrower) view returns (uint256)",
  "function getTroveMaxBorrowingCapacity(address) view returns (uint256)",
  "function getTroveInterestRate(address) view returns (uint16)",
  "function getTroveOwnersCount() view returns (uint256)",
  "function getTroveFromTroveOwnersArray(uint256 _index) view returns (address)",
  "function checkRecoveryMode(uint256 _price) view returns (bool)",
  "function getTCR(uint256 _price) view returns (uint256)",
  "function getEntireSystemColl() view returns (uint256)",
  "function getEntireSystemDebt() view returns (uint256)",
  "event TroveUpdated(address indexed _borrower, uint256 _principal, uint256 _interest, uint256 _coll, uint256 _stake, uint16 _interestRate, uint256 _lastInterestUpdateTime, uint8 _operation)",
  "event TroveLiquidated(address indexed _borrower, uint256 _debt, uint256 _coll, uint8 _operation)",
  "event Redemption(uint256 _attemptedAmount, uint256 _actualAmount, uint256 _collateralSent, uint256 _collateralFee)",
]);

export const sortedTrovesAbi = parseAbi([
  "function getSize() view returns (uint256)",
  "function getFirst() view returns (address)",
  "function getLast() view returns (address)",
  "function getNext(address) view returns (address)",
  "function getPrev(address) view returns (address)",
  "function contains(address) view returns (bool)",
  "function findInsertPosition(uint256 _NICR, address _prevId, address _nextId) view returns (address, address)",
]);

export const hintHelpersAbi = parseAbi([
  "function getApproxHint(uint256 _CR, uint256 _numTrials, uint256 _inputRandomSeed) view returns (address hintAddress, uint256 diff, uint256 latestRandomSeed)",
]);

export const priceFeedAbi = parseAbi(["function fetchPrice() view returns (uint256)"]);

export const aggregatorV3Abi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

export const interestRateManagerAbi = parseAbi(["function interestRate() view returns (uint16)"]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

/** Morpho Blue core. MarketParams = (loanToken, collateralToken, oracle, irm, lltv). */
export const morphoAbi = parseAbi([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
  "function repay(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)",
  "function supplyCollateral(MarketParams marketParams, uint256 assets, address onBehalf, bytes data)",
  "function withdrawCollateral(MarketParams marketParams, uint256 assets, address onBehalf, address receiver)",
  "event CreateMarket(bytes32 indexed id, MarketParams marketParams)",
  "event Borrow(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)",
  "event SupplyCollateral(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets)",
  "event Repay(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)",
  "event Liquidate(bytes32 indexed id, address indexed caller, address indexed borrower, uint256 repaidAssets, uint256 repaidShares, uint256 seizedAssets, uint256 badDebtAssets, uint256 badDebtShares)",
]);

/** Morpho IRM (AdaptiveCurveIrm) — borrowRateView for accrued-interest projection. */
export const morphoIrmAbi = parseAbi([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "struct Market { uint128 totalSupplyAssets; uint128 totalSupplyShares; uint128 totalBorrowAssets; uint128 totalBorrowShares; uint128 lastUpdate; uint128 fee; }",
  "function borrowRateView(MarketParams marketParams, Market market) view returns (uint256)",
]);

/** Morpho oracle: price of 1 collateral unit in loan units, scaled by 1e36 (adjusted for decimals). */
export const morphoOracleAbi = parseAbi(["function price() view returns (uint256)"]);
