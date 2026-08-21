// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IW0G} from "./interfaces/IW0G.sol";

/// @title BeaconNativeVault — prepaid native 0G under owner policy
/// @notice Executor may spend only within owner-set caps. TEE is never a role.
///         Wealth is native 0G + W0G (1:1 wrap). Wrap/unwrap is not economic spend.
///         A Zia swap that leaves W0G/native is spend even if another token arrives.
contract BeaconNativeVault {
    IW0G public immutable w0g;

    address public owner;
    address public executor;

    bool public paused;
    uint256 private _status;

    uint256 public maxSpendPerTx;
    uint256 public rollingWindowBudget;
    uint256 public rollingWindowSeconds;
    uint256 public sessionExpiresAt;

    uint256 public windowStart;
    uint256 public windowSpent;
    uint256 public executeNonce;

    mapping(address => bool) public allowedTargets;
    mapping(bytes4 => bool) public allowedSelectors;
    mapping(uint256 => bool) public usedNonces;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ExecutorUpdated(address indexed previousExecutor, address indexed newExecutor);
    event Deposited(address indexed from, uint256 amount, uint256 wealthAfter);
    event Withdrawn(address indexed to, uint256 amount, uint256 wealthAfter);
    event PolicyUpdated(
        uint256 maxSpendPerTx,
        uint256 rollingWindowBudget,
        uint256 rollingWindowSeconds,
        uint256 sessionExpiresAt
    );
    event TargetAllowlistUpdated(address indexed target, bool allowed);
    event SelectorAllowlistUpdated(bytes4 indexed selector, bool allowed);
    event PauseSet(bool paused);
    event Executed(
        address indexed executor,
        address indexed target,
        bytes4 indexed selector,
        uint256 spent,
        uint256 wealthBefore,
        uint256 wealthAfter,
        uint256 nonce
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyExecutor() {
        require(msg.sender == executor, "not executor");
        _;
    }

    modifier nonReentrant() {
        require(_status == 0, "reentrant");
        _status = 1;
        _;
        _status = 0;
    }

    constructor(address w0g_, address owner_, address executor_) {
        require(w0g_ != address(0) && owner_ != address(0), "zero address");
        w0g = IW0G(w0g_);
        owner = owner_;
        executor = executor_;
        emit OwnershipTransferred(address(0), owner_);
        emit ExecutorUpdated(address(0), executor_);
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value, wealth());
    }

    function deposit() external payable nonReentrant {
        require(msg.value > 0, "zero amount");
        emit Deposited(msg.sender, msg.value, wealth());
    }

    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "zero amount");
        require(address(this).balance >= amount, "insufficient native");
        (bool ok, ) = owner.call{value: amount}("");
        require(ok, "withdraw failed");
        emit Withdrawn(owner, amount, wealth());
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setExecutor(address newExecutor) external onlyOwner {
        emit ExecutorUpdated(executor, newExecutor);
        executor = newExecutor;
    }

    function setPolicy(
        uint256 maxSpendPerTx_,
        uint256 rollingWindowBudget_,
        uint256 rollingWindowSeconds_,
        uint256 sessionExpiresAt_
    ) external onlyOwner {
        require(rollingWindowSeconds_ > 0, "bad window");
        maxSpendPerTx = maxSpendPerTx_;
        rollingWindowBudget = rollingWindowBudget_;
        rollingWindowSeconds = rollingWindowSeconds_;
        sessionExpiresAt = sessionExpiresAt_;
        windowStart = block.timestamp;
        windowSpent = 0;
        emit PolicyUpdated(maxSpendPerTx_, rollingWindowBudget_, rollingWindowSeconds_, sessionExpiresAt_);
    }

    function setAllowedTarget(address target, bool allowed) external onlyOwner {
        require(target != address(0), "zero target");
        allowedTargets[target] = allowed;
        emit TargetAllowlistUpdated(target, allowed);
    }

    function setAllowedSelector(bytes4 selector, bool allowed) external onlyOwner {
        allowedSelectors[selector] = allowed;
        emit SelectorAllowlistUpdated(selector, allowed);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PauseSet(paused_);
    }

    /// @notice Native + W0G 1:1 wealth. USDC.e and other tokens are ignored on purpose.
    function wealth() public view returns (uint256) {
        return address(this).balance + w0g.balanceOf(address(this));
    }

    function balance() external view returns (uint256) {
        return wealth();
    }

    /// @param value Native 0G forwarded with the call (wrap / payable escrow lock).
    function execute(
        address target,
        bytes calldata data,
        uint256 maxSpend,
        uint256 nonce_,
        uint256 value
    ) external onlyExecutor nonReentrant returns (bytes memory result) {
        require(!paused, "paused");
        require(sessionExpiresAt == 0 || block.timestamp < sessionExpiresAt, "session expired");
        require(allowedTargets[target], "target not allowed");
        require(data.length >= 4, "no selector");
        bytes4 selector = bytes4(data[0:4]);
        require(allowedSelectors[selector], "selector not allowed");
        require(!usedNonces[nonce_], "nonce used");
        usedNonces[nonce_] = true;
        executeNonce = nonce_;
        require(value <= address(this).balance, "insufficient native");

        uint256 wealthBefore = wealth();

        (bool ok, bytes memory ret) = target.call{value: value}(data);
        require(ok, "call failed");

        uint256 wealthAfter = wealth();
        require(wealthAfter <= wealthBefore, "unexpected credit");
        uint256 spent = wealthBefore - wealthAfter;
        require(spent <= maxSpend, "over maxSpend");
        require(spent <= maxSpendPerTx, "over per-tx budget");

        _consumeRollingBudget(spent);

        emit Executed(msg.sender, target, selector, spent, wealthBefore, wealthAfter, nonce_);
        return ret;
    }

    function _consumeRollingBudget(uint256 spent) internal {
        if (windowStart == 0 || block.timestamp >= windowStart + rollingWindowSeconds) {
            windowStart = block.timestamp;
            windowSpent = 0;
        }
        windowSpent += spent;
        require(windowSpent <= rollingWindowBudget, "over window budget");
    }
}
