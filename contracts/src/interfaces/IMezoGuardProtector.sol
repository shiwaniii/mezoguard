// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IMezoGuardProtector — FROZEN interface
/// @notice Opt-in, user-funded, repay-only automation for Mezo MUSD Troves.
/// A borrower deposits an MUSD budget and stores ONE EIP-712 `RepayMUSD` signature (signed for
/// BorrowerOperationsSignatures) together with a trigger ICR, expiry and optional executor.
/// Anyone allowed by the rule may call `executeRepay` only when the Trove's live ICR (TroveManager.getCurrentICR at
/// PriceFeed.fetchPrice) is BELOW the trigger. The protector then calls
/// BorrowerOperationsSignatures.repayMUSDWithSignature, which burns MUSD from THIS contract (the caller) — never from
/// the borrower's wallet. Through THIS contract the only effect on the user is debt reduction from their own budget.
/// The trigger and executor limit only calls through this contract: the stored signature is public, and any MUSD holder
/// can submit it to BorrowerOperationsSignatures directly, with their own MUSD, at any ICR before its deadline. That
/// repays the borrower's debt, consumes the nonce and leaves the rule unable to run. Deadlines are capped
/// (MAX_SIG_DURATION) to bound that window.
/// Revocation: `revoke()` disarms and refunds the remaining budget. It does NOT cancel the signature at
/// BorrowerOperationsSignatures: it stays valid until its deadline or until the borrower signs any other
/// BorrowerOperationsSignatures operation (nonce bump). `arm` refuses a new signature while the previous one is live.
/// A rule stops when the Trove closes: executeRepay requires an active Trove and anyone can call `disarmIfClosed`.
interface IMezoGuardProtector {
    struct Rule {
        uint256 budget;        // MUSD held for this borrower (18 dec)
        uint256 repayAmount;   // exact amount the stored signature authorises
        uint256 triggerIcr;    // 1e18-scaled; execute only if current ICR < triggerIcr
        uint256 sigDeadline;   // deadline signed into the signature (also acts as rule expiry)
        address executor;      // address(0) = any keeper
        bool armed;
        bytes signature;       // EIP-712 RepayMUSD signature by the borrower
    }

    event Deposited(address indexed borrower, uint256 amount, uint256 newBudget);
    event Withdrawn(address indexed borrower, uint256 amount, uint256 newBudget);
    event Armed(address indexed borrower, uint256 repayAmount, uint256 triggerIcr, uint256 sigDeadline, address executor);
    event Revoked(address indexed borrower, uint256 refunded);
    event Disarmed(address indexed borrower);
    event ProtectionExecuted(address indexed borrower, address indexed executor, uint256 repaid, uint256 icrBefore, uint256 icrAfter, uint256 price);

    error NotArmed();
    error Expired();
    error NotExecutor();
    error InsufficientBudget();
    error AboveTrigger(uint256 icr, uint256 trigger);
    error InvalidParams();
    error NoImprovement();
    error PreviousSignatureLive();
    error TroveNotActive();
    error TroveStillActive();
    error RepayBelowMinNetDebt();
    error RepayLeavesIcrBelowMcr();

    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function arm(uint256 repayAmount, uint256 triggerIcr, uint256 sigDeadline, address executor, bytes calldata signature) external;
    function revoke() external;
    function disarmIfClosed(address borrower) external;
    function executeRepay(address borrower, address upperHint, address lowerHint) external;

    function ruleOf(address borrower) external view returns (Rule memory);
    /// @return ready true if executeRepay would pass the protector's own checks right now; icr = current ICR.
    function canExecute(address borrower) external view returns (bool ready, uint256 icr, string memory reason);

    function musd() external view returns (address);
    function troveManager() external view returns (address);
    function priceFeed() external view returns (address);
    function borrowerOperationsSignatures() external view returns (address);
}
