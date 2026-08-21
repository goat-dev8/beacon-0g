// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BeaconJobEscrow} from "../src/BeaconJobEscrow.sol";
import {BeaconNativeVault} from "../src/BeaconNativeVault.sol";
import {MockW0G} from "../src/mocks/MockW0G.sol";

contract BeaconJobEscrowTest is Test {
    BeaconJobEscrow internal escrow;
    BeaconNativeVault internal vault;
    MockW0G internal w0g;

    address internal treasury = address(0xB0B);
    address internal settler = address(0x5E11);
    address internal owner = address(0xA11CE);
    address internal executor = address(0xE1);

    bytes32 internal jobA = keccak256("job-a");
    bytes32 internal jobB = keccak256("job-b");

    bytes4 internal constant LOCK_SEL = bytes4(keccak256("lockNative(bytes32)"));

    function setUp() public {
        vm.deal(treasury, 0);
        escrow = new BeaconJobEscrow(treasury, settler);
        w0g = new MockW0G();
        vault = new BeaconNativeVault(address(w0g), owner, executor);

        vm.deal(owner, 20 ether);
        vm.prank(owner);
        vault.deposit{value: 5 ether}();
        vm.startPrank(owner);
        vault.setPolicy(5 ether, 10 ether, 7 days, 0);
        vault.setAllowedTarget(address(escrow), true);
        vault.setAllowedSelector(LOCK_SEL, true);
        vm.stopPrank();
    }

    function testLockReleaseMovesValueToTreasury() public {
        vm.prank(executor);
        vault.execute(address(escrow), abi.encodeWithSelector(LOCK_SEL, jobA), 1 ether, 1, 1 ether);

        (address payer, uint256 amount, bool released, bool refunded) = escrow.locks(jobA);
        assertEq(payer, address(vault));
        assertEq(amount, 1 ether);
        assertFalse(released);
        assertFalse(refunded);
        assertEq(address(escrow).balance, 1 ether);
        assertEq(vault.wealth(), 4 ether);

        vm.prank(settler);
        escrow.release(jobA);
        assertEq(treasury.balance, 1 ether);
        assertEq(address(escrow).balance, 0);
        (, , bool releasedAfter, ) = escrow.locks(jobA);
        assertTrue(releasedAfter);
    }

    function testLockRefundReturnsToVault() public {
        uint256 wealthBefore = vault.wealth();
        vm.prank(executor);
        vault.execute(address(escrow), abi.encodeWithSelector(LOCK_SEL, jobB), 0.02 ether, 1, 0.02 ether);
        assertEq(vault.wealth(), wealthBefore - 0.02 ether);

        vm.prank(settler);
        escrow.refund(jobB);
        assertEq(vault.wealth(), wealthBefore);
        assertEq(address(escrow).balance, 0);
        assertEq(treasury.balance, 0);
    }

    function testCannotDoubleSettle() public {
        vm.prank(executor);
        vault.execute(address(escrow), abi.encodeWithSelector(LOCK_SEL, jobA), 1 ether, 1, 1 ether);
        vm.prank(settler);
        escrow.refund(jobA);
        vm.prank(settler);
        vm.expectRevert("settled");
        escrow.release(jobA);
    }

    function testStrangerCannotRelease() public {
        vm.prank(executor);
        vault.execute(address(escrow), abi.encodeWithSelector(LOCK_SEL, jobA), 1 ether, 1, 1 ether);
        vm.expectRevert("not owner");
        escrow.release(jobA);
    }

    function testDuplicateLockReverts() public {
        vm.prank(executor);
        vault.execute(address(escrow), abi.encodeWithSelector(LOCK_SEL, jobA), 1 ether, 1, 1 ether);
        vm.prank(executor);
        vm.expectRevert("call failed");
        vault.execute(address(escrow), abi.encodeWithSelector(LOCK_SEL, jobA), 1 ether, 2, 1 ether);
    }
}
