// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BeaconNativeVault} from "./BeaconNativeVault.sol";

/// @title BeaconVaultFactory — one personal native-0G Beacon Safe per wallet
contract BeaconVaultFactory {
    bytes4 internal constant W0G_DEPOSIT = bytes4(keccak256("deposit()"));
    bytes4 internal constant W0G_WITHDRAW = bytes4(keccak256("withdraw(uint256)"));
    bytes4 internal constant W0G_APPROVE = bytes4(keccak256("approve(address,uint256)"));
    bytes4 internal constant ESCROW_LOCK = bytes4(keccak256("lockNative(bytes32)"));
    bytes4 internal constant EXACT_INPUT_SINGLE = 0x414bf389;
    bytes4 internal constant EXACT_INPUT = 0xb858183f;
    bytes4 internal constant MULTICALL = bytes4(keccak256("multicall(uint256,bytes[])"));
    bytes4 internal constant REFUND_ETH = bytes4(keccak256("refundETH()"));
    bytes4 internal constant UNWRAP_WETH9 = bytes4(keccak256("unwrapWETH9(uint256,address)"));

    address public immutable w0g;
    address public immutable defaultExecutor;
    address public immutable jobEscrow;
    address public immutable ziaRouter;

    uint256 public immutable defaultMaxSpendPerTx;
    uint256 public immutable defaultRollingBudget;
    uint256 public immutable defaultRollingSeconds;

    mapping(address => address) public safeOf;
    address[] public allSafes;

    event SafeCreated(address indexed owner, address indexed safe, address indexed executor);

    error ZeroAddress();
    error BadWindow();
    error SafeExists(address owner, address existing);

    constructor(
        address w0g_,
        address defaultExecutor_,
        address jobEscrow_,
        address ziaRouter_,
        uint256 defaultMaxSpendPerTx_,
        uint256 defaultRollingBudget_,
        uint256 defaultRollingSeconds_
    ) {
        if (w0g_ == address(0) || defaultExecutor_ == address(0) || jobEscrow_ == address(0) || ziaRouter_ == address(0)) {
            revert ZeroAddress();
        }
        if (defaultRollingSeconds_ == 0) revert BadWindow();
        w0g = w0g_;
        defaultExecutor = defaultExecutor_;
        jobEscrow = jobEscrow_;
        ziaRouter = ziaRouter_;
        defaultMaxSpendPerTx = defaultMaxSpendPerTx_;
        defaultRollingBudget = defaultRollingBudget_;
        defaultRollingSeconds = defaultRollingSeconds_;
    }

    function createSafe() external returns (address safe) {
        return _createSafe(msg.sender);
    }

    function predictSafe(address owner) external view returns (address predicted) {
        bytes32 salt = _salt(owner);
        bytes memory init = abi.encodePacked(
            type(BeaconNativeVault).creationCode,
            abi.encode(w0g, address(this), defaultExecutor)
        );
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(init)));
        predicted = address(uint160(uint256(hash)));
    }

    function hasSafe(address owner) external view returns (bool) {
        return safeOf[owner] != address(0);
    }

    function safeCount() external view returns (uint256) {
        return allSafes.length;
    }

    function _createSafe(address owner) internal returns (address safe) {
        if (owner == address(0)) revert ZeroAddress();
        address existing = safeOf[owner];
        if (existing != address(0)) revert SafeExists(owner, existing);

        bytes32 salt = _salt(owner);
        BeaconNativeVault vault = new BeaconNativeVault{salt: salt}(w0g, address(this), defaultExecutor);
        safe = address(vault);

        vault.setAllowedTarget(w0g, true);
        vault.setAllowedSelector(W0G_DEPOSIT, true);
        vault.setAllowedSelector(W0G_WITHDRAW, true);
        vault.setAllowedSelector(W0G_APPROVE, true);

        vault.setAllowedTarget(jobEscrow, true);
        vault.setAllowedSelector(ESCROW_LOCK, true);

        vault.setAllowedTarget(ziaRouter, true);
        vault.setAllowedSelector(EXACT_INPUT_SINGLE, true);
        vault.setAllowedSelector(EXACT_INPUT, true);
        vault.setAllowedSelector(MULTICALL, true);
        vault.setAllowedSelector(REFUND_ETH, true);
        vault.setAllowedSelector(UNWRAP_WETH9, true);

        vault.setPolicy(defaultMaxSpendPerTx, defaultRollingBudget, defaultRollingSeconds, 0);
        vault.transferOwnership(owner);

        safeOf[owner] = safe;
        allSafes.push(safe);
        emit SafeCreated(owner, safe, defaultExecutor);
    }

    function _salt(address owner) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("beacon.native.safe.v1", owner));
    }
}
