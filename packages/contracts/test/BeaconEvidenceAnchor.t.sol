// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BeaconEvidenceAnchor} from "../src/BeaconEvidenceAnchor.sol";

contract BeaconEvidenceAnchorTest is Test {
    BeaconEvidenceAnchor internal anchor;
    address internal owner = address(0xA11CE);
    address internal recorder = address(0x1234);
    address internal stranger = address(0xBAD);

    function setUp() public {
        anchor = new BeaconEvidenceAnchor(owner);
        vm.prank(owner);
        anchor.setRecorder(recorder, true);
    }

    function testAnchorOnce() public {
        bytes32 root = keccak256("batch");
        vm.prank(recorder);
        anchor.anchor(root, 3);
        (bool exists, , address who, uint32 n) = anchor.batches(root);
        assertTrue(exists);
        assertEq(who, recorder);
        assertEq(n, 3);
        assertEq(anchor.latestRoot(), root);

        vm.prank(recorder);
        vm.expectRevert("already anchored");
        anchor.anchor(root, 3);
    }

    function testUnauthorizedRecorder() public {
        vm.prank(stranger);
        vm.expectRevert("not recorder");
        anchor.anchor(keccak256("x"), 1);
    }
}
