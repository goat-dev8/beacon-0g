// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BeaconReceiptRegistry} from "../src/BeaconReceiptRegistry.sol";

contract BeaconReceiptRegistryTest is Test {
    BeaconReceiptRegistry internal registry;
    address internal owner = address(0xA11CE);
    address internal recorder = address(0x1234);
    address internal stranger = address(0xBAD);

    function setUp() public {
        registry = new BeaconReceiptRegistry(owner);
        vm.prank(owner);
        registry.setRecorder(recorder, true);
    }

    function testRecordOnce() public {
        bytes32 jobId = keccak256("job");
        vm.prank(recorder);
        registry.record(jobId, keccak256("root"), address(0x711), keccak256("chat"), keccak256("quote"), true);
        (bytes32 root, address tee, , , bool allowed, bool exists, , ) = registry.receipts(jobId);
        assertTrue(exists);
        assertEq(root, keccak256("root"));
        assertEq(tee, address(0x711));
        assertTrue(allowed);

        vm.prank(recorder);
        vm.expectRevert("already recorded");
        registry.record(jobId, bytes32(uint256(1)), address(0), bytes32(0), bytes32(0), false);
    }

    function testUnauthorizedRecorder() public {
        vm.prank(stranger);
        vm.expectRevert("not recorder");
        registry.record(keccak256("x"), bytes32(0), address(0), bytes32(0), bytes32(0), false);
    }
}
