// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {Xueni} from "../src/Xueni.sol";
import {MultiHook} from "../src/hooks/MultiHook.sol";

/// @title CREATE2 deterministic deployment of Xueni and its fan-out hook.
///
/// @notice The same procedure as Create2Deploy.s.sol: both contracts go
///         through the canonical deterministic deployment proxy (Arachnid,
///         0x4e59b44847b379578588920ca78fbf26c0b4956c) with fixed salts, so
///         each lands at ONE address on every EVM chain. The MultiHook's init
///         code embeds the Xueni address, which is itself deterministic, so
///         its address is deterministic too.
///
///         The salts and init-code hashes below are pinned to the compiled
///         bytecode. If Xueni.sol or MultiHook.sol changes, re-mine:
///
///           cast create2 --starts-with 000000 --init-code $(forge inspect src/Xueni.sol:Xueni bytecode)
///           cast create2 --starts-with 00000  --init-code $(cast concat-hex $(forge inspect src/hooks/MultiHook.sol:MultiHook bytecode) $(cast abi-encode 'f(address)' <XUENI_ADDRESS>))
///
///         Anyone can run this — the deployer gains no privilege. Usage:
///           forge script script/Create2DeployXueni.s.sol:Create2DeployXueni \
///             --rpc-url $ETH_RPC --broadcast
///         (PRIVATE_KEY is read from the environment by vm.envUint.)
///
///         Idempotent: whatever already has code at its address is verified
///         and skipped.
contract Create2DeployXueni is Script {
    address internal constant PROXY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // --- Xueni (6 leading zeros) ---
    bytes32 internal constant SALT = 0x0603693f73b74be0d29d96d4ceac3d45c73a32d3190edd048fc2347fcfdf7c56;
    bytes32 internal constant INIT_CODE_HASH = 0x21bb8135a2cf7b4ce30e0c2ca8354801651767f9115a0b9b06f188f09dbb7fe6;
    address internal constant EXPECTED_ADDRESS = 0x0000008D02020df6bCDD56A888cFC9eD9b9053eC;

    // --- MultiHook(Xueni) (5 leading zeros) ---
    bytes32 internal constant MULTI_SALT = 0xdc284105e2f18cd3db78e88dcd75b3596e2b64c85d8da994e018d23941ac49eb;
    bytes32 internal constant MULTI_INIT_CODE_HASH = 0x0e015a32a032e837072b30a8f87083159a0e4d9b633910264fd871821289d1de;
    address internal constant MULTI_EXPECTED_ADDRESS = 0x00000e2b71d66E5fEDA58A70e6D5AE3762a18D93;

    function run() external {
        if (PROXY.code.length == 0) {
            console2.log("Canonical proxy missing on this chain - deploy it keylessly first (see README)");
            revert("canonical deterministic deployment proxy not deployed on this chain");
        }
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        bytes memory initCode = type(Xueni).creationCode;
        require(keccak256(initCode) == INIT_CODE_HASH, "Xueni bytecode changed - re-mine the salt (see above)");
        address xueni = _deploy("Xueni", SALT, INIT_CODE_HASH, initCode, EXPECTED_ADDRESS, deployerPrivateKey);

        bytes memory multiInit = abi.encodePacked(type(MultiHook).creationCode, abi.encode(xueni));
        require(keccak256(multiInit) == MULTI_INIT_CODE_HASH, "MultiHook bytecode changed - re-mine the salt (see above)");
        _deploy("MultiHook", MULTI_SALT, MULTI_INIT_CODE_HASH, multiInit, MULTI_EXPECTED_ADDRESS, deployerPrivateKey);
    }

    function _deploy(
        string memory name,
        bytes32 salt,
        bytes32 initCodeHash,
        bytes memory initCode,
        address expected,
        uint256 deployerPrivateKey
    ) internal returns (address) {
        require(vm.computeCreate2Address(salt, initCodeHash, PROXY) == expected, "computed address differs from the recorded one");
        if (expected.code.length > 0) {
            console2.log(name, "already deployed at:", expected);
            return expected;
        }
        vm.startBroadcast(deployerPrivateKey);
        // The proxy forwards msg.value with no refund: send exactly 0.
        (bool ok, bytes memory ret) = PROXY.call(abi.encodePacked(salt, initCode));
        vm.stopBroadcast();
        require(ok, "CREATE2 deploy through the proxy failed");
        require(ret.length >= 20, "proxy returned no address");
        // forge-lint: disable-next-line(unsafe-typecast)
        address deployed = address(bytes20(ret));
        require(deployed == expected, "deployed address differs from expected");
        console2.log(name, "deployed at:", deployed);
        return deployed;
    }
}
