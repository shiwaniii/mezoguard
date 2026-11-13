// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IMezoGuardProtector} from "./interfaces/IMezoGuardProtector.sol";

/// @dev Minimal views of the Mezo MUSD contracts this protector touches.
interface ITroveManagerLike {
    function getCurrentICR(address borrower, uint256 price) external view returns (uint256);
    function getTroveStatus(address borrower) external view returns (uint8);
    function checkRecoveryMode(uint256 price) external view returns (bool);
    /// @dev Mezo returns coll and principal/interest with pending redistribution already folded in.
    function getEntireDebtAndColl(address borrower)
        external
        view
        returns (uint256 coll, uint256 principal, uint256 interest, uint256, uint256, uint256);
}

interface IBorrowerOperationsLike {
    function minNetDebt() external view returns (uint256);
}

interface IPriceFeedLike {
    function fetchPrice() external view returns (uint256);
}

interface IBorrowerOperationsSignaturesLike {
    function getNonce(address user) external view returns (uint256);
    function borrowerOperations() external view returns (address);

    function repayMUSDWithSignature(
        uint256 amount,
        address upperHint,
        address lowerHint,
        address borrower,
        bytes memory signature,
        uint256 deadline
    ) external;
}

/// @title MezoGuardProtector
/// @notice Opt-in, user-funded, repay-only automation for Mezo MUSD Troves. See IMezoGuardProtector for the model.
/// @dev No owner, no admin, no upgradeability. Budgets are only moved by (a) the borrower via withdraw/revoke and
/// (b) the MUSD burn performed by BorrowerOperations during executeRepay, which burns from THIS contract (the caller of
/// BorrowerOperationsSignatures). The contract never grants any allowance — MUSD.burn needs none.
contract MezoGuardProtector is IMezoGuardProtector, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Repay burned a different amount than the signed amount (would break per-borrower accounting).
    error UnexpectedBurn(uint256 expected, uint256 actual);
    /// @notice Signature does not recover to msg.sender for the current BorrowerOperationsSignatures nonce.
    error InvalidSignature();
    error ZeroAddress();

    /// @dev Same strings / typehash as mezo-org/musd BorrowerOperationsSignatures.
    bytes32 public constant REPAY_MUSD_TYPEHASH =
        keccak256("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)");
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant HASHED_NAME = keccak256("BorrowerOperationsSignatures");
    bytes32 private constant HASHED_VERSION = keccak256("1");

    /// @notice Trigger bounds (1e18 = 100%). The floor sits well above Mezo's 110% MCR: a trigger at MCR would only
    /// fire once the Trove is already liquidatable, and in Normal Mode BorrowerOperations rejects a repay that leaves
    /// ICR below MCR. Above 1000% a trigger is almost certainly a mistake.
    uint256 public constant MIN_TRIGGER_ICR = 1.2e18;
    uint256 public constant MAX_TRIGGER_ICR = 10e18;
    /// @notice A stored signature may live at most this long (limits the window of a public, caller-agnostic signature).
    uint256 public constant MAX_SIG_DURATION = 90 days;
    /// @notice Mezo constants (LiquityBase): minimum collateral ratio and the gas compensation reserved in every Trove.
    uint256 public constant MCR = 1.1e18;
    uint256 public constant MUSD_GAS_COMPENSATION = 200e18;
    uint8 private constant TROVE_ACTIVE = 1;

    IERC20 private immutable _musd;
    ITroveManagerLike private immutable _troveManager;
    IPriceFeedLike private immutable _priceFeed;
    IBorrowerOperationsSignaturesLike private immutable _bos;
    IBorrowerOperationsLike private immutable _bo;

    mapping(address borrower => Rule) private _rules;
    /// @notice BorrowerOperationsSignatures nonce the stored signature was made for (lets canExecute detect invalidation).
    mapping(address borrower => uint256) public armedNonce;
    /// @notice Nonce and deadline of the LAST signature this contract accepted for a borrower. Never cleared: revoke and
    /// disarm cannot cancel a signature at BorrowerOperationsSignatures, so arm refuses a new signature while the
    /// previous one is still usable there (same nonce, deadline not passed).
    mapping(address borrower => uint256) public lastSignedNonce;
    mapping(address borrower => uint256) public lastSignedDeadline;

    constructor(address musd_, address troveManager_, address priceFeed_, address borrowerOperationsSignatures_) {
        if (
            musd_ == address(0) || troveManager_ == address(0) || priceFeed_ == address(0)
                || borrowerOperationsSignatures_ == address(0)
        ) revert ZeroAddress();
        _musd = IERC20(musd_);
        _troveManager = ITroveManagerLike(troveManager_);
        _priceFeed = IPriceFeedLike(priceFeed_);
        _bos = IBorrowerOperationsSignaturesLike(borrowerOperationsSignatures_);
        address bo = IBorrowerOperationsSignaturesLike(borrowerOperationsSignatures_).borrowerOperations();
        if (bo == address(0)) revert ZeroAddress();
        _bo = IBorrowerOperationsLike(bo);
    }

    // ---------------------------------------------------------------- budget

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidParams();
        Rule storage r = _rules[msg.sender];
        r.budget += amount;
        _musd.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount, r.budget);
    }

    function withdraw(uint256 amount) external nonReentrant {
        Rule storage r = _rules[msg.sender];
        if (amount == 0) revert InvalidParams();
        if (amount > r.budget) revert InsufficientBudget();
        r.budget -= amount;
        _musd.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, r.budget);
    }

    // ---------------------------------------------------------------- rule

    function arm(uint256 repayAmount, uint256 triggerIcr, uint256 sigDeadline, address executor, bytes calldata signature)
        external
        nonReentrant
    {
        if (repayAmount == 0) revert InvalidParams();
        if (triggerIcr < MIN_TRIGGER_ICR || triggerIcr > MAX_TRIGGER_ICR) revert InvalidParams();
        if (sigDeadline <= block.timestamp || sigDeadline > block.timestamp + MAX_SIG_DURATION) revert InvalidParams();
        if (_troveManager.getTroveStatus(msg.sender) != TROVE_ACTIVE) revert TroveNotActive();

        uint256 nonce = _bos.getNonce(msg.sender);
        // An earlier signature at this same nonce is still valid at BorrowerOperationsSignatures; anyone could submit it
        // and kill the new rule. The borrower must first consume the nonce with any signed BorrowerOperations action.
        if (lastSignedDeadline[msg.sender] >= block.timestamp && lastSignedNonce[msg.sender] == nonce) {
            revert PreviousSignatureLive();
        }
        _checkRepayFits(msg.sender, repayAmount);

        bytes32 digest = _repayDigest(repayAmount, msg.sender, nonce, sigDeadline);
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || recovered != msg.sender) revert InvalidSignature();

        Rule storage r = _rules[msg.sender];
        r.repayAmount = repayAmount;
        r.triggerIcr = triggerIcr;
        r.sigDeadline = sigDeadline;
        r.executor = executor;
        r.armed = true;
        r.signature = signature;
        armedNonce[msg.sender] = nonce;
        lastSignedNonce[msg.sender] = nonce;
        lastSignedDeadline[msg.sender] = sigDeadline;

        emit Armed(msg.sender, repayAmount, triggerIcr, sigDeadline, executor);
    }

    function revoke() external nonReentrant {
        Rule storage r = _rules[msg.sender];
        uint256 refund = r.budget;
        delete _rules[msg.sender];
        delete armedNonce[msg.sender];
        if (refund > 0) _musd.safeTransfer(msg.sender, refund);
        emit Revoked(msg.sender, refund);
    }

    /// @notice Anyone can disarm the rule of a borrower whose Trove is no longer active (closed by the owner, liquidated
    /// or redeemed). Without this, a rule armed for a closed Trove would repay a later Trove at the same address.
    /// The budget stays with the borrower (withdraw or revoke).
    function disarmIfClosed(address borrower) external nonReentrant {
        Rule storage r = _rules[borrower];
        if (!r.armed) revert NotArmed();
        if (_troveManager.getTroveStatus(borrower) == TROVE_ACTIVE) revert TroveStillActive();
        r.armed = false;
        delete r.signature;
        emit Disarmed(borrower);
    }

    // ---------------------------------------------------------------- execution

    function executeRepay(address borrower, address upperHint, address lowerHint) external nonReentrant {
        Rule storage r = _rules[borrower];
        if (!r.armed) revert NotArmed();
        if (block.timestamp > r.sigDeadline) revert Expired();
        if (r.executor != address(0) && msg.sender != r.executor) revert NotExecutor();
        uint256 amount = r.repayAmount;
        if (r.budget < amount) revert InsufficientBudget();

        if (_troveManager.getTroveStatus(borrower) != TROVE_ACTIVE) revert TroveNotActive();

        uint256 price = _priceFeed.fetchPrice();
        uint256 icrBefore = _troveManager.getCurrentICR(borrower, price);
        if (icrBefore >= r.triggerIcr) revert AboveTrigger(icrBefore, r.triggerIcr);
        // Fail with a clear reason instead of inside BorrowerOperations.
        _checkRepayFits(borrower, amount);
        if (!_troveManager.checkRecoveryMode(price) && _icrAfterRepay(borrower, amount, price) < MCR) {
            revert RepayLeavesIcrBelowMcr();
        }

        // Effects: one-shot — the signature's nonce is consumed by BOS, so the rule can never run twice.
        bytes memory signature = r.signature;
        uint256 deadline = r.sigDeadline;
        r.budget -= amount;
        r.armed = false;
        delete r.signature;

        uint256 balBefore = _musd.balanceOf(address(this));
        _bos.repayMUSDWithSignature(amount, upperHint, lowerHint, borrower, signature, deadline);
        uint256 balAfter = _musd.balanceOf(address(this));
        // BorrowerOperations burns principal + interest adjustments, which sum to exactly `amount`.
        if (balBefore - balAfter != amount) revert UnexpectedBurn(amount, balBefore - balAfter);

        uint256 icrAfter = _troveManager.getCurrentICR(borrower, price);
        if (icrAfter <= icrBefore) revert NoImprovement();

        emit ProtectionExecuted(borrower, msg.sender, amount, icrBefore, icrAfter, price);
    }

    // ---------------------------------------------------------------- views

    function ruleOf(address borrower) external view returns (Rule memory) {
        return _rules[borrower];
    }

    /// @dev Does not check `executor` (depends on the caller). Mirrors every check executeRepay makes before calling
    /// BorrowerOperationsSignatures, including Trove status, minimum net debt and the Normal-Mode MCR rule.
    function canExecute(address borrower) external view returns (bool ready, uint256 icr, string memory reason) {
        Rule storage r = _rules[borrower];
        if (!r.armed) return (false, 0, "not armed");
        if (block.timestamp > r.sigDeadline) return (false, 0, "expired");
        if (r.budget < r.repayAmount) return (false, 0, "insufficient budget");
        try _bos.getNonce(borrower) returns (uint256 n) {
            if (n != armedNonce[borrower]) return (false, 0, "signature invalidated (nonce changed)");
        } catch {
            return (false, 0, "nonce unavailable");
        }
        uint256 price;
        try _priceFeed.fetchPrice() returns (uint256 p) {
            price = p;
        } catch {
            return (false, 0, "price unavailable");
        }
        try _troveManager.getCurrentICR(borrower, price) returns (uint256 v) {
            icr = v;
        } catch {
            return (false, 0, "icr unavailable");
        }
        if (icr >= r.triggerIcr) return (false, icr, "above trigger");
        if (_troveManager.getTroveStatus(borrower) != TROVE_ACTIVE) return (false, icr, "trove not active");
        (uint256 coll, uint256 debt) = _debtAndColl(borrower);
        if (debt < r.repayAmount + MUSD_GAS_COMPENSATION + _bo.minNetDebt()) {
            return (false, icr, "repay would leave net debt below minimum");
        }
        if (!_troveManager.checkRecoveryMode(price) && (coll * price) / (debt - r.repayAmount) < MCR) {
            return (false, icr, "repay would leave ICR below MCR");
        }
        return (true, icr, "");
    }

    /// @notice The exact EIP-712 digest BorrowerOperationsSignatures verifies for repayMUSDWithSignature.
    function repayDigest(address borrower, uint256 amount, uint256 nonce, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _repayDigest(amount, borrower, nonce, deadline);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, HASHED_NAME, HASHED_VERSION, block.chainid, address(_bos)));
    }

    function musd() external view returns (address) {
        return address(_musd);
    }

    function troveManager() external view returns (address) {
        return address(_troveManager);
    }

    function priceFeed() external view returns (address) {
        return address(_priceFeed);
    }

    function borrowerOperationsSignatures() external view returns (address) {
        return address(_bos);
    }

    function borrowerOperations() external view returns (address) {
        return address(_bo);
    }

    function _debtAndColl(address borrower) private view returns (uint256 coll, uint256 debt) {
        (uint256 c, uint256 principal, uint256 interest,,,) = _troveManager.getEntireDebtAndColl(borrower);
        return (c, principal + interest);
    }

    /// @dev BorrowerOperations requires repay <= debt - gas compensation and net debt after >= minNetDebt.
    function _checkRepayFits(address borrower, uint256 amount) private view {
        (, uint256 debt) = _debtAndColl(borrower);
        if (debt < amount + MUSD_GAS_COMPENSATION + _bo.minNetDebt()) revert RepayBelowMinNetDebt();
    }

    function _icrAfterRepay(address borrower, uint256 amount, uint256 price) private view returns (uint256) {
        (uint256 coll, uint256 debt) = _debtAndColl(borrower);
        return (coll * price) / (debt - amount);
    }

    /// @dev Mirrors BOS._verifySignature byte-for-byte:
    /// keccak256(abi.encodePacked(typeHash, abi.encode(amount, borrower), nonce, deadline)) then _hashTypedDataV4.
    function _repayDigest(uint256 amount, address borrower, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash =
            keccak256(abi.encodePacked(REPAY_MUSD_TYPEHASH, abi.encode(amount, borrower), nonce, deadline));
        return MessageHashUtils.toTypedDataHash(domainSeparator(), structHash);
    }
}
