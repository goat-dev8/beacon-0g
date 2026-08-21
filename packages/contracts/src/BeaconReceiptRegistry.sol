// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title BeaconReceiptRegistry — on-chain commitment of a job proof packet
/// @notice Stores hashes and public identifiers. Private blobs live in 0G Storage.
contract BeaconReceiptRegistry {
    address public owner;
    mapping(address => bool) public recorders;

    struct Receipt {
        bytes32 storageRoot;
        address teeSigner;
        bytes32 chatIdHash;
        bytes32 quoteHash;
        bool allowed;
        bool exists;
        uint256 recordedAt;
        address recorder;
    }

    mapping(bytes32 => Receipt) public receipts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RecorderUpdated(address indexed account, bool allowed);
    event Recorded(
        bytes32 indexed jobId,
        bytes32 storageRoot,
        address teeSigner,
        bytes32 chatIdHash,
        bytes32 quoteHash,
        bool allowed
    );

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

    function record(
        bytes32 jobId,
        bytes32 storageRoot,
        address teeSigner,
        bytes32 chatIdHash,
        bytes32 quoteHash,
        bool allowed
    ) external onlyRecorder {
        require(jobId != bytes32(0), "zero job");
        require(!receipts[jobId].exists, "already recorded");
        receipts[jobId] = Receipt({
            storageRoot: storageRoot,
            teeSigner: teeSigner,
            chatIdHash: chatIdHash,
            quoteHash: quoteHash,
            allowed: allowed,
            exists: true,
            recordedAt: block.timestamp,
            recorder: msg.sender
        });
        emit Recorded(jobId, storageRoot, teeSigner, chatIdHash, quoteHash, allowed);
    }
}
