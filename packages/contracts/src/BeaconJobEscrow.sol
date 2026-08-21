// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title BeaconJobEscrow — lock native 0G on authorize, release or refund by outcome
/// @notice Payable lock from a Beacon Safe (or a user). Settler (owner) releases to
///         treasury payee or refunds the payer. Funds never sit in a TEE.
contract BeaconJobEscrow {
    address public immutable payee;
    address public owner;

    uint256 public lockedTotal;

    struct Lock {
        address payer;
        uint256 amount;
        bool released;
        bool refunded;
    }

    mapping(bytes32 => Lock) public locks;

    event Locked(bytes32 indexed jobId, address indexed payer, uint256 amount);
    event Released(bytes32 indexed jobId, address indexed payee, uint256 amount);
    event Refunded(bytes32 indexed jobId, address indexed payer, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address payee_, address owner_) {
        require(payee_ != address(0) && owner_ != address(0), "zero address");
        payee = payee_;
        owner = owner_;
    }

    receive() external payable {}

    function freeBalance() public view returns (uint256) {
        return address(this).balance > lockedTotal ? address(this).balance - lockedTotal : 0;
    }

    /// @notice Lock `msg.value` native 0G for `jobId`. Payer is msg.sender (typically the Safe).
    function lockNative(bytes32 jobId) external payable {
        require(locks[jobId].payer == address(0), "already locked");
        require(msg.value > 0, "zero amount");
        lockedTotal += msg.value;
        locks[jobId] = Lock({payer: msg.sender, amount: msg.value, released: false, refunded: false});
        emit Locked(jobId, msg.sender, msg.value);
    }

    /// @notice Record a lock for native 0G already held by this escrow (prepaid path).
    function lockPrepaid(bytes32 jobId, address payer, uint256 amount) external onlyOwner {
        require(payer != address(0), "zero payer");
        require(amount > 0, "zero amount");
        require(locks[jobId].payer == address(0), "already locked");
        require(freeBalance() >= amount, "insufficient prepaid");
        lockedTotal += amount;
        locks[jobId] = Lock({payer: payer, amount: amount, released: false, refunded: false});
        emit Locked(jobId, payer, amount);
    }

    function release(bytes32 jobId) external onlyOwner {
        Lock storage entry = locks[jobId];
        require(entry.payer != address(0), "no lock");
        require(!entry.released && !entry.refunded, "settled");
        entry.released = true;
        lockedTotal -= entry.amount;
        (bool ok, ) = payee.call{value: entry.amount}("");
        require(ok, "release failed");
        emit Released(jobId, payee, entry.amount);
    }

    function refund(bytes32 jobId) external onlyOwner {
        Lock storage entry = locks[jobId];
        require(entry.payer != address(0), "no lock");
        require(!entry.released && !entry.refunded, "settled");
        entry.refunded = true;
        lockedTotal -= entry.amount;
        (bool ok, ) = entry.payer.call{value: entry.amount}("");
        require(ok, "refund failed");
        emit Refunded(jobId, entry.payer, entry.amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        owner = newOwner;
    }
}
