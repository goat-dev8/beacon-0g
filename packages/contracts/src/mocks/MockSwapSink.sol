// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @dev Pulls W0G from msg.sender via transferFrom — stands in for a DEX router.
contract MockSwapSink {
    function swapTake(address token, uint256 amount) external {
        (bool ok, bytes memory ret) = token.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amount)
        );
        require(ok, "call failed");
        if (ret.length > 0) {
            require(abi.decode(ret, (bool)), "transferFrom false");
        }
    }
}
