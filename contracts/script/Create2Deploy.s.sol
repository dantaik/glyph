// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {Glyph} from "../src/Blog.sol";

/// @title CREATE2 deterministic deployment of the shared, ownerless Glyph contract.
///
/// @notice Deploys `Glyph` through the canonical deterministic deployment proxy
///         (Arachnid, 0x4e59b44847b379578588920ca78fbf26c0b4956c) with a fixed
///         vanity salt. A CREATE2 address depends only on
///         (deployer, salt, init-code hash); the proxy itself sits at the same
///         address on every EVM chain (it can be deployed keylessly anywhere),
///         so Glyph lands at the SAME address on every chain:
///
///             0x000000AE2f2249c497cfc5F262dd1491634C361C  (6 leading zeros)
///
///         Anyone can run this script — the deployer gains no privileges.
///         Usage:
///           forge script script/Create2Deploy.s.sol:Create2DeployGlyph \
///             --rpc-url $ETH_RPC --broadcast
///         (PRIVATE_KEY is read from the environment by vm.envUint.)
///
///         Idempotent: if the address already has code, the script verifies it
///         and exits without broadcasting.
contract Create2DeployGlyph is Script {
    /// Canonical deterministic deployment proxy (Arachnid), keylessly
    /// deployable at this exact address on any chain.
    address internal constant PROXY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    /// Vanity salt mined with `cast create2 --starts-with 000000`.
    bytes32 internal constant SALT = 0x00436d208c20757dde791d2c0c0909a2c8ea61482d3fa516692d9ee5244440f1;

    /// keccak256(type(Glyph).creationCode) at the time the salt was mined.
    /// If Blog.sol changes, this must be re-mined (see README).
    bytes32 internal constant INIT_CODE_HASH = 0x2d087c683d199f0d5d835f323462ddb3680ba048a4ef29f350dd784f3402b5cb;

    address internal constant EXPECTED_ADDRESS = 0x000000AE2f2249c497cfc5F262dd1491634C361C;

    function run() external {
        bytes memory initCode = type(Glyph).creationCode;
        require(
            keccak256(initCode) == INIT_CODE_HASH,
            "Glyph bytecode changed - re-mine the salt (see README)"
        );

        if (PROXY.code.length == 0) {
            console2.log("Canonical proxy missing on this chain - deploy it keylessly first (see README):");
            console2.log("  1. fund 0x3fab184622dc19b6109349b94811493bf2a45362 with >= 0.01 ETH");
            console2.log("  2. cast publish <raw signed tx from Arachnid's deterministic-deployment-proxy>");
            revert("canonical deterministic deployment proxy not deployed on this chain");
        }

        address expected = vm.computeCreate2Address(SALT, INIT_CODE_HASH, PROXY);
        require(expected == EXPECTED_ADDRESS, "computed address differs from the recorded one");

        if (EXPECTED_ADDRESS.code.length > 0) {
            require(
                EXPECTED_ADDRESS.codehash == keccak256(type(Glyph).runtimeCode),
                "code already present at the address but differs from Glyph runtime"
            );
            console2.log("Glyph already deployed at:", EXPECTED_ADDRESS);
            return;
        }

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);
        // IMPORTANT: the proxy forwards all msg.value into the created contract
        // and has no refund — send exactly 0 so no ETH gets locked inside the
        // ownerless Glyph contract. The CREATE2 gas is paid by this transaction.
        (bool ok, bytes memory ret) = PROXY.call(abi.encodePacked(SALT, initCode));
        vm.stopBroadcast();

        require(ok, "CREATE2 deploy through the proxy failed");
        require(ret.length >= 20, "proxy returned no address");
        // The proxy returns the deployed address as 20 raw bytes (not ABI-
        // encoded); taking the first 20 bytes of the return data is exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        address deployed = address(bytes20(ret));
        require(deployed == EXPECTED_ADDRESS, "deployed address differs from expected");
        require(deployed.codehash == keccak256(type(Glyph).runtimeCode), "runtime code mismatch");

        console2.log("Glyph deployed at:", deployed);
        console2.log("Verify with:");
        console2.log("  forge verify-contract", deployed, "src/Blog.sol:Glyph --chain <chainid> --etherscan-api-key $KEY");
    }
}
