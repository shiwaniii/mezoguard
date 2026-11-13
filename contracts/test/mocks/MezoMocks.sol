// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev Mirrors mezo-org/musd MUSD: mint/burn only by allow-listed system contracts, burn needs NO allowance,
/// transfers to address(0) or the token itself are rejected.
contract MockMUSD is ERC20 {
    mapping(address => bool) public burnList;
    mapping(address => bool) public mintList;

    constructor() ERC20("Mezo USD", "MUSD") {
        mintList[msg.sender] = true;
    }

    function setSystem(address a, bool canMint, bool canBurn) external {
        mintList[a] = canMint;
        burnList[a] = canBurn;
    }

    function mint(address to, uint256 amount) external {
        require(mintList[msg.sender], "MUSD: Caller not allowed to mint");
        _mint(to, amount);
    }

    function burn(address account, uint256 amount) external {
        require(burnList[msg.sender], "MUSD: Caller not allowed to burn");
        _burn(account, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            require(to != address(this), "MUSD: Cannot transfer tokens directly to the MUSD token contract");
        }
        super._update(from, to, value);
    }
}

contract MockPriceFeed {
    uint256 public price;
    bool public stale;

    constructor(uint256 p) {
        price = p;
    }

    function setPrice(uint256 p) external {
        price = p;
    }

    function setStale(bool s) external {
        stale = s;
    }

    function fetchPrice() external view returns (uint256) {
        require(!stale, "PriceFeed: Oracle is stale.");
        return price;
    }
}

/// @dev Debt/coll bookkeeping with Mezo's getCurrentICR semantics (coll * price / debt; max uint when debt == 0).
contract MockTroveManager {
    enum Status { nonExistent, active, closedByOwner, closedByLiquidation, closedByRedemption }

    struct Trove {
        uint256 coll;
        uint256 debt; // principal + interest, incl. 200 MUSD gas compensation
        Status status;
    }

    mapping(address => Trove) public troves;
    address public borrowerOperations;
    bool public recoveryMode;

    function setRecoveryMode(bool r) external {
        recoveryMode = r;
    }

    function checkRecoveryMode(uint256) external view returns (bool) {
        return recoveryMode;
    }

    /// @dev Same return shape as Mezo: (coll, principal, interest, pendingColl, pendingPrincipal, pendingInterest).
    function getEntireDebtAndColl(address b) external view returns (uint256, uint256, uint256, uint256, uint256, uint256) {
        return (troves[b].coll, troves[b].debt, 0, 0, 0, 0);
    }

    function setBorrowerOperations(address bo) external {
        borrowerOperations = bo;
    }

    function setTrove(address b, uint256 coll, uint256 debt) external {
        troves[b] = Trove(coll, debt, Status.active);
    }

    function closeTrove(address b) external {
        troves[b].status = Status.closedByOwner;
    }

    function decreaseDebt(address b, uint256 amount) external {
        require(msg.sender == borrowerOperations, "TM: only BO");
        troves[b].debt -= amount;
    }

    function getTroveDebt(address b) external view returns (uint256) {
        return troves[b].debt;
    }

    function getTroveStatus(address b) external view returns (Status) {
        return troves[b].status;
    }

    function getCurrentICR(address b, uint256 price) external view returns (uint256) {
        Trove memory t = troves[b];
        if (t.debt == 0) return type(uint256).max;
        return (t.coll * price) / t.debt;
    }
}

/// @dev Ports BorrowerOperationsSignatures._verifySignature verbatim (EIP-712 "BorrowerOperationsSignatures"/"1",
/// per-borrower sequential nonce, deadline) and folds in the BorrowerOperations._adjustTrove repay path:
/// trove active, amount <= debt - gasComp, net debt after >= minNetDebt, CALLER (msg.sender) has the MUSD,
/// Normal Mode requires newICR >= MCR, then burn from msg.sender.
contract MockBorrowerOperationsSignatures is EIP712 {
    bytes32 private constant REPAY_MUSD_TYPEHASH =
        keccak256("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)");
    bytes32 private constant ADD_COLL_TYPEHASH =
        keccak256("AddColl(uint256 assetAmount,address borrower,uint256 nonce,uint256 deadline)");

    uint256 public constant MCR = 1.1e18;
    uint256 public constant MUSD_GAS_COMPENSATION = 200e18;

    MockMUSD public immutable musd;
    MockTroveManager public immutable troveManager;
    MockPriceFeed public immutable priceFeed;
    uint256 public minNetDebt = 1800e18;

    mapping(address => uint256) private nonces;

    constructor(MockMUSD m, MockTroveManager tm, MockPriceFeed pf) EIP712("BorrowerOperationsSignatures", "1") {
        musd = m;
        troveManager = tm;
        priceFeed = pf;
    }

    function setRecoveryMode(bool r) external {
        troveManager.setRecoveryMode(r);
    }

    /// @dev The mock plays BorrowerOperations too (minNetDebt lives here).
    function borrowerOperations() external view returns (address) {
        return address(this);
    }

    function setMinNetDebt(uint256 v) external {
        minNetDebt = v;
    }

    function getNonce(address user) public view returns (uint256) {
        return nonces[user];
    }

    function repayMUSDWithSignature(
        uint256 _amount,
        address _upperHint,
        address _lowerHint,
        address _borrower,
        bytes memory _signature,
        uint256 _deadline
    ) external virtual {
        _verifySignature(REPAY_MUSD_TYPEHASH, abi.encode(_amount, _borrower), _borrower, _signature, _deadline);
        _repay(_borrower, msg.sender, _amount, _upperHint, _lowerHint);
    }

    /// @dev Any other signed op bumps the nonce (used to show invalidation of a stored repay signature).
    function addCollWithSignature(address, address, address _borrower, bytes memory _signature, uint256 _deadline)
        external
        payable
    {
        _verifySignature(ADD_COLL_TYPEHASH, abi.encode(msg.value, _borrower), _borrower, _signature, _deadline);
    }

    function _repay(address borrower, address caller, uint256 amount, address, address) internal {
        require(amount > 0, "BorrowerOps: There must be either a collateral change or a debt change");
        require(
            troveManager.getTroveStatus(borrower) == MockTroveManager.Status.active,
            "BorrowerOps: Trove does not exist or is closed"
        );
        uint256 price = priceFeed.fetchPrice();
        (uint256 coll, uint256 debt,) = troveManager.troves(borrower);
        uint256 newDebt = debt - amount;
        if (!troveManager.recoveryMode()) {
            require((coll * price) / newDebt >= MCR, "BorrowerOps: An operation that would result in ICR < MCR is not permitted");
        }
        require(debt - MUSD_GAS_COMPENSATION - amount >= minNetDebt, "BorrowerOps: Trove's net debt must be greater than minimum");
        require(amount <= debt - MUSD_GAS_COMPENSATION, "BorrowerOps: Amount repaid must not be larger than the Trove's debt");
        require(musd.balanceOf(caller) >= amount, "BorrowerOps: Caller doesnt have enough mUSD to make repayment");
        troveManager.decreaseDebt(borrower, amount);
        musd.burn(caller, amount);
    }

    function _verifySignature(
        bytes32 _typeHash,
        bytes memory _data,
        address _borrower,
        bytes memory _signature,
        uint256 _deadline
    ) internal {
        require(block.timestamp <= _deadline, "Signature expired");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encodePacked(_typeHash, _data, nonces[_borrower], _deadline)));
        address recoveredAddress = ECDSA.recover(digest, _signature);
        require(recoveredAddress == _borrower, "BorrowerOperationsSignatures: Invalid signature");
        nonces[_borrower]++;
    }

    function hashTypedDataV4(bytes32 structHash) external view returns (bytes32) {
        return _hashTypedDataV4(structHash);
    }
}

interface IProtectorReenter {
    function executeRepay(address borrower, address upperHint, address lowerHint) external;
    function withdraw(uint256 amount) external;
}

/// @dev Hostile BOS that re-enters the protector during repay. Used only to prove nonReentrant holds.
contract ReentrantBOS is MockBorrowerOperationsSignatures {
    IProtectorReenter public target;
    uint8 public mode; // 1 = re-enter executeRepay, 2 = re-enter withdraw

    constructor(MockMUSD m, MockTroveManager tm, MockPriceFeed pf) MockBorrowerOperationsSignatures(m, tm, pf) {}

    function setAttack(IProtectorReenter t, uint8 m) external {
        target = t;
        mode = m;
    }

    function repayMUSDWithSignature(uint256, address, address, address _borrower, bytes memory, uint256)
        external
        override
    {
        if (mode == 1) target.executeRepay(_borrower, address(0), address(0));
        else if (mode == 2) target.withdraw(1);
    }
}

/// @dev Malicious BOS that burns more than the signed amount (proves UnexpectedBurn guards pooled budgets).
contract OverBurnBOS is MockBorrowerOperationsSignatures {
    constructor(MockMUSD m, MockTroveManager tm, MockPriceFeed pf) MockBorrowerOperationsSignatures(m, tm, pf) {}

    function repayMUSDWithSignature(uint256 _amount, address, address, address _borrower, bytes memory, uint256)
        external
        override
    {
        troveManager.decreaseDebt(_borrower, _amount);
        musd.burn(msg.sender, _amount + 1);
    }
}
