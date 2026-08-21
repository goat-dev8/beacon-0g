// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BeaconNativeVault} from "../src/BeaconNativeVault.sol";
import {MockW0G} from "../src/mocks/MockW0G.sol";
import {MockSwapSink} from "../src/mocks/MockSwapSink.sol";

contract BeaconNativeVaultTest is Test {
    MockW0G internal w0g;
    BeaconNativeVault internal vault;
    MockSwapSink internal sink;

    address internal owner = address(0xA11CE);
    address internal executor = address(0xE1);
    address internal stranger = address(0xBAD);

    bytes4 internal constant DEPOSIT_SEL = bytes4(keccak256("deposit()"));
    bytes4 internal constant WITHDRAW_SEL = bytes4(keccak256("withdraw(uint256)"));
    bytes4 internal constant APPROVE_SEL = bytes4(keccak256("approve(address,uint256)"));
    bytes4 internal constant SWAP_TAKE_SEL = bytes4(keccak256("swapTake(address,uint256)"));

    function setUp() public {
        w0g = new MockW0G();
        vault = new BeaconNativeVault(address(w0g), owner, executor);
        sink = new MockSwapSink();

        vm.deal(owner, 100 ether);
        vm.prank(owner);
        vault.deposit{value: 10 ether}();

        vm.startPrank(owner);
        vault.setPolicy(2 ether, 8 ether, 1 days, block.timestamp + 7 days);
        vault.setAllowedTarget(address(w0g), true);
        vault.setAllowedSelector(DEPOSIT_SEL, true);
        vault.setAllowedSelector(WITHDRAW_SEL, true);
        vault.setAllowedSelector(APPROVE_SEL, true);
        vault.setAllowedTarget(address(sink), true);
        vault.setAllowedSelector(SWAP_TAKE_SEL, true);
        vm.stopPrank();
    }

    function testDepositIncreasesWealth() public view {
        assertEq(vault.wealth(), 10 ether);
        assertEq(address(vault).balance, 10 ether);
    }

    function testAnyoneCanDeposit_OwnerWithdraws() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        vault.deposit{value: 0.4 ether}();
        assertEq(vault.wealth(), 10.4 ether);

        vm.prank(executor);
        vm.expectRevert("not owner");
        vault.withdraw(1);

        uint256 before = owner.balance;
        vm.prank(owner);
        vault.withdraw(1 ether);
        assertEq(owner.balance, before + 1 ether);
        assertEq(vault.wealth(), 9.4 ether);
    }

    function testWrapIsNotSpend() public {
        bytes memory data = abi.encodeWithSelector(DEPOSIT_SEL);
        vm.prank(executor);
        vault.execute(address(w0g), data, 1 ether, 1, 1 ether);
        assertEq(vault.wealth(), 10 ether);
        assertEq(address(vault).balance, 9 ether);
        assertEq(w0g.balanceOf(address(vault)), 1 ether);
        assertEq(vault.windowSpent(), 0);
    }

    function testUnwrapIsNotSpend() public {
        vm.prank(executor);
        vault.execute(address(w0g), abi.encodeWithSelector(DEPOSIT_SEL), 1 ether, 1, 1 ether);

        vm.prank(executor);
        vault.execute(address(w0g), abi.encodeWithSelector(WITHDRAW_SEL, uint256(1 ether)), 1 ether, 2, 0);
        assertEq(vault.wealth(), 10 ether);
        assertEq(address(vault).balance, 10 ether);
        assertEq(w0g.balanceOf(address(vault)), 0);
        assertEq(vault.windowSpent(), 0);
    }

    function testSwapIsSpend() public {
        vm.prank(executor);
        vault.execute(address(w0g), abi.encodeWithSelector(DEPOSIT_SEL), 2 ether, 1, 2 ether);

        vm.prank(executor);
        vault.execute(
            address(w0g),
            abi.encodeWithSelector(APPROVE_SEL, address(sink), uint256(2 ether)),
            0,
            2,
            0
        );

        vm.prank(executor);
        vault.execute(
            address(sink),
            abi.encodeWithSelector(SWAP_TAKE_SEL, address(w0g), uint256(1.5 ether)),
            2 ether,
            3,
            0
        );
        assertEq(vault.wealth(), 8.5 ether);
        assertEq(vault.windowSpent(), 1.5 ether);
        assertEq(w0g.balanceOf(address(sink)), 1.5 ether);
    }

    function testWrapUnwrapDoesNotInflateSpend() public {
        for (uint256 i = 1; i <= 5; i++) {
            vm.prank(executor);
            vault.execute(address(w0g), abi.encodeWithSelector(DEPOSIT_SEL), 1 ether, i * 2, 1 ether);
            vm.prank(executor);
            vault.execute(address(w0g), abi.encodeWithSelector(WITHDRAW_SEL, uint256(1 ether)), 1 ether, i * 2 + 1, 0);
        }
        assertEq(vault.windowSpent(), 0);
        assertEq(vault.wealth(), 10 ether);
    }

    function testPauseBlocksExecute() public {
        vm.prank(owner);
        vault.setPaused(true);
        vm.prank(executor);
        vm.expectRevert("paused");
        vault.execute(address(w0g), abi.encodeWithSelector(DEPOSIT_SEL), 1 ether, 1, 1 ether);

        vm.prank(owner);
        vault.withdraw(1 ether);
    }

    function testNonceReplay() public {
        vm.prank(executor);
        vault.execute(address(w0g), abi.encodeWithSelector(DEPOSIT_SEL), 1 ether, 7, 1 ether);
        vm.prank(executor);
        vm.expectRevert("nonce used");
        vault.execute(address(w0g), abi.encodeWithSelector(DEPOSIT_SEL), 1 ether, 7, 1 ether);
    }

    function testUnauthorizedTarget() public {
        vm.prank(executor);
        vm.expectRevert("target not allowed");
        vault.execute(stranger, abi.encodeWithSelector(DEPOSIT_SEL), 1 ether, 1, 0);
    }

    function testUnauthorizedSelector() public {
        bytes4 bad = bytes4(keccak256("transfer(address,uint256)"));
        vm.prank(executor);
        vm.expectRevert("selector not allowed");
        vault.execute(address(w0g), abi.encodeWithSelector(bad, stranger, uint256(1)), 1 ether, 1, 0);
    }

    function testExecutorCannotSetPolicy() public {
        vm.prank(executor);
        vm.expectRevert("not owner");
        vault.setPolicy(1, 1, 1, 0);
    }

    function testOverPerTxBudget() public {
        vm.prank(executor);
        vault.execute(address(w0g), abi.encodeWithSelector(DEPOSIT_SEL), 3 ether, 1, 3 ether);
        vm.prank(executor);
        vault.execute(
            address(w0g),
            abi.encodeWithSelector(APPROVE_SEL, address(sink), uint256(3 ether)),
            0,
            2,
            0
        );
        vm.prank(executor);
        vm.expectRevert("over per-tx budget");
        vault.execute(
            address(sink),
            abi.encodeWithSelector(SWAP_TAKE_SEL, address(w0g), uint256(2.5 ether)),
            3 ether,
            3,
            0
        );
    }

    function testSessionExpiry() public {
        vm.prank(owner);
        vault.setPolicy(2 ether, 8 ether, 1 days, block.timestamp + 10);
        vm.warp(block.timestamp + 11);
        vm.prank(executor);
        vm.expectRevert("session expired");
        vault.execute(address(w0g), abi.encodeWithSelector(DEPOSIT_SEL), 1 ether, 1, 1 ether);
    }

    function testRollingWindow() public {
        vm.prank(owner);
        vault.setPolicy(2 ether, 5 ether, 1 days, block.timestamp + 7 days);

        vm.prank(executor);
        vault.execute(address(w0g), abi.encodeWithSelector(DEPOSIT_SEL), 8 ether, 1, 8 ether);
        vm.prank(executor);
        vault.execute(
            address(w0g),
            abi.encodeWithSelector(APPROVE_SEL, address(sink), type(uint256).max),
            0,
            2,
            0
        );
        vm.prank(executor);
        vault.execute(
            address(sink),
            abi.encodeWithSelector(SWAP_TAKE_SEL, address(w0g), uint256(2 ether)),
            2 ether,
            3,
            0
        );
        vm.prank(executor);
        vault.execute(
            address(sink),
            abi.encodeWithSelector(SWAP_TAKE_SEL, address(w0g), uint256(2 ether)),
            2 ether,
            4,
            0
        );
        vm.prank(executor);
        vm.expectRevert("over window budget");
        vault.execute(
            address(sink),
            abi.encodeWithSelector(SWAP_TAKE_SEL, address(w0g), uint256(2 ether)),
            2 ether,
            5,
            0
        );

        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(executor);
        vault.execute(
            address(sink),
            abi.encodeWithSelector(SWAP_TAKE_SEL, address(w0g), uint256(1 ether)),
            1 ether,
            6,
            0
        );
        assertEq(vault.windowSpent(), 1 ether);
    }
}
