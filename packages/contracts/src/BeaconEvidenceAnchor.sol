// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title BeaconEvidenceAnchor — one on-chain root for many job/action hashes
/// @notice Individual jobs stay independently verifiable via an off-chain Merkle proof.
contract BeaconEvidenceAnchor {
    address public owner;
    mapping(address => bool) public recorders;

    struct Batch {
        bool exists;
        uint256 recordedAt;
        address recorder;
        uint32 leafCount;
    }

    mapping(bytes32 => Batch) public batches;
    bytes32 public latestRoot;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RecorderUpdated(address indexed account, bool allowed);
    event Anchored(bytes32 indexed root, uint32 leafCount, address recorder);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyRecorder() {
        require(msg.sender == owner || recorders[msg.sender], "not recorder");
        _;
    }

    constructor(address owner_) {
        require(owner_ != address(0), "zero owner");
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setRecorder(address account, bool allowed) external onlyOwner {
        require(account != address(0), "zero account");
        recorders[account] = allowed;
        emit RecorderUpdated(account, allowed);
    }

    function anchor(bytes32 root, uint32 leafCount) external onlyRecorder {
        require(root != bytes32(0), "zero root");
        require(leafCount > 0, "empty batch");
        require(!batches[root].exists, "already anchored");
        batches[root] = Batch({
            exists: true,
            recordedAt: block.timestamp,
            recorder: msg.sender,
            leafCount: leafCount
        });
        latestRoot = root;
        emit Anchored(root, leafCount, msg.sender);
    }
}
