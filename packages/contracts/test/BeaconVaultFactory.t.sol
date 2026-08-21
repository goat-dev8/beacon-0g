// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BeaconVaultFactory} from "../src/BeaconVaultFactory.sol";
import {BeaconNativeVault} from "../src/BeaconNativeVault.sol";
import {BeaconJobEscrow} from "../src/BeaconJobEscrow.sol";
import {MockW0G} from "../src/mocks/MockW0G.sol";

contract BeaconVaultFactoryTest is Test {
    MockW0G internal w0g;
    BeaconJobEscrow internal escrow;
    BeaconVaultFactory internal factory;
    address internal executor = address(0xE1);
    address internal user = address(0xA11CE);
    address internal zia = address(0x18cCa38E51c4C339A6BD6e174025f08360FEEf30);

    function setUp() public {
        w0g = new MockW0G();
        escrow = new BeaconJobEscrow(address(0xB0B), executor);
        factory = new BeaconVaultFactory(
            address(w0g),
            executor,
            address(escrow),
            zia,
            0.5 ether,
            5 ether,
            7 days
        );
    }

    function testCreateSafeSeedsAllowlistsAndPolicy() public {
        vm.prank(user);
        address safe = factory.createSafe();
        assertEq(factory.safeOf(user), safe);
        assertEq(factory.predictSafe(user), safe);

        BeaconNativeVault vault = BeaconNativeVault(payable(safe));
        assertEq(vault.owner(), user);
        assertEq(vault.executor(), executor);
        assertEq(vault.maxSpendPerTx(), 0.5 ether);
        assertTrue(vault.allowedTargets(address(w0g)));
        assertTrue(vault.allowedTargets(address(escrow)));
        assertTrue(vault.allowedTargets(zia));
        assertTrue(vault.allowedSelectors(bytes4(keccak256("lockNative(bytes32)"))));
        assertTrue(vault.allowedSelectors(bytes4(0x414bf389)));
    }

    function testDuplicateSafeReverts() public {
        vm.prank(user);
        factory.createSafe();
        vm.prank(user);
        vm.expectRevert();
        factory.createSafe();
    }
}
