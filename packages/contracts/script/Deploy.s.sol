// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {BeaconJobEscrow} from "../src/BeaconJobEscrow.sol";
import {BeaconReceiptRegistry} from "../src/BeaconReceiptRegistry.sol";
import {BeaconVaultFactory} from "../src/BeaconVaultFactory.sol";

/// @notice Deploy P0 stack to 0G Aristotle (16661).
contract Deploy is Script {
    address constant W0G = 0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c;
    address constant ZIA_ROUTER = 0x18cCa38E51c4C339A6BD6e174025f08360FEEf30;

    function run() external {
        uint256 pk = vm.envUint("ZEROG_DEPLOYER_PK");
        address deployer = vm.addr(pk);
        address treasury = vm.envOr("BEACON_TREASURY", deployer);
        address settler = vm.envOr("BEACON_SETTLER", deployer);

        vm.startBroadcast(pk);

        BeaconJobEscrow escrow = new BeaconJobEscrow(treasury, settler);
        BeaconReceiptRegistry receipts = new BeaconReceiptRegistry(settler);
        receipts.setRecorder(settler, true);

        BeaconVaultFactory factory = new BeaconVaultFactory(
            W0G,
            settler,
            address(escrow),
            ZIA_ROUTER,
            0.5 ether,
            5 ether,
            7 days
        );

        vm.stopBroadcast();

        vm.writeFile(
            "deployments/16661.json",
            string.concat(
                "{\n",
                '  "chainId": 16661,\n',
                '  "deployer": "',
                vm.toString(deployer),
                '",\n',
                '  "escrow": "',
                vm.toString(address(escrow)),
                '",\n',
                '  "receipts": "',
                vm.toString(address(receipts)),
                '",\n',
                '  "factory": "',
                vm.toString(address(factory)),
                '",\n',
                '  "w0g": "',
                vm.toString(W0G),
                '",\n',
                '  "ziaRouter": "',
                vm.toString(ZIA_ROUTER),
                '"\n',
                "}\n"
            )
        );
    }
}
