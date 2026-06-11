// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {Glyph} from "../src/Blog.sol";

/// @notice Deploy the Glyph contract. The deployer address becomes the author.
///         Usage:
///           forge script script/Deploy.s.sol:DeployBlog \
///             --rpc-url $ETH_RPC \
///             --private-key $PRIVATE_KEY \
///             --broadcast \
///             --verify --etherscan-api-key $ETHERSCAN_KEY
contract DeployBlog is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);
        new Glyph();
        vm.stopBroadcast();
    }
}
