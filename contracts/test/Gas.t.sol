// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Glyph} from "../src/Blog.sol";
import {GlyphV2} from "../src/GlyphV2.sol";
import {IPublishHook} from "../src/IPublishHook.sol";

/// @dev The least a hook can do: accept. What the core's side of a hook
///      call costs, with nothing of the hook's own in it.
contract NoopHook is IPublishHook {
    function onPublish(address, address, uint256, uint256, bytes32, bytes calldata, bytes calldata)
        external
        payable
        returns (bytes4)
    {
        return IPublishHook.onPublish.selector;
    }
}

/// @title What the second contract costs, next to the first.
/// @notice These are steady-state numbers: the author's second post, with
///         the author's slot and both contracts already touched in this
///         transaction, so what is measured is the contract's own work.
///         A real transaction adds the same 21,000 base, the same calldata
///         and the same cold-access charges to every one of these, and
///         under EIP-7623 the calldata floor (10 gas per token) usually
///         swallows the whole execution anyway — see glyph-spec §4.1.
///
///         The bounds are regression guards, not targets: a change that
///         makes the plain post cost more than one extra topic over v1, or
///         a hook call or a relayed post cost more than they do today, is
///         a change somebody should have to explain.
contract GasTest is Test {
    Glyph internal v1;
    GlyphV2 internal v2;
    NoopHook internal hook;

    uint256 internal constant PK = 0xA11CE;
    address internal author;
    bytes32 internal constant TITLE = bytes32("A letter before the solstice");

    function setUp() public {
        v1 = new Glyph();
        v2 = new GlyphV2();
        hook = new NoopHook();
        author = vm.addr(PK);
    }

    /// A payload of the given size with no zero bytes, as compressed text has none.
    function _payload(uint256 size) internal pure returns (bytes memory p) {
        p = new bytes(size);
        for (uint256 i = 0; i < size; i++) {
            p[i] = bytes1(uint8(0x21 + (i % 90)));
        }
    }

    /// One post on each contract, so that the slot, the addresses and the
    /// memory are warm on both sides alike before anything is measured.
    function _warm(bytes memory payload) internal {
        vm.startPrank(author);
        v1.publish(TITLE, payload);
        v2.publish(TITLE, payload);
        vm.stopPrank();
        vm.roll(block.number + 1);
    }

    function _v1(bytes memory payload) internal returns (uint256 used) {
        vm.prank(author);
        uint256 before = gasleft();
        v1.publish(TITLE, payload);
        used = before - gasleft();
    }

    function _v2Plain(bytes memory payload) internal returns (uint256 used) {
        vm.prank(author);
        uint256 before = gasleft();
        v2.publish(TITLE, payload);
        used = before - gasleft();
    }

    function _v2Hooked(bytes memory payload) internal returns (uint256 used) {
        vm.prank(author);
        uint256 before = gasleft();
        v2.publish(TITLE, payload, address(hook), "");
        used = before - gasleft();
    }

    function _v2Relayed(bytes memory payload) internal returns (uint256 used) {
        uint256 deadline = block.timestamp + 1 days;
        bytes32 digest = v2.publishDigest(author, TITLE, keccak256(payload), address(0), keccak256(""), v2.count(author), deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        address relayer = address(0xBEEF);
        vm.prank(relayer);
        uint256 before = gasleft();
        v2.publishFor(author, TITLE, payload, address(0), "", deadline, signature);
        used = before - gasleft();
    }

    function test_gas_aPlainPostOnV2CostsOneTopicMoreThanV1() public {
        bytes memory payload = _payload(2048);
        _warm(payload);
        uint256 one = _v1(payload);
        uint256 two = _v2Plain(payload);
        console2.log("v1 publish, 2 KiB payload, warm:          ", one);
        console2.log("v2 publish (plain), 2 KiB payload, warm:  ", two);
        console2.log("v2 over v1:                               ", two - one);
        // The hook is an indexed topic of the v2 event: 375 gas. The rest is
        // the dispatch over ten functions instead of three, the zero-hook and
        // no-value checks, and the plumbing into the shared `_publish`:
        // measured at 749 in all. Anything past 900 is new.
        assertGe(two, one + 375);
        assertLe(two - one, 900);
    }

    function test_gas_aHookCallIsABoundedOverheadOnThePost() public {
        bytes memory payload = _payload(2048);
        _warm(payload);
        uint256 plain = _v2Plain(payload);
        uint256 hooked = _v2Hooked(payload);
        console2.log("v2 publish (plain), 2 KiB:                ", plain);
        console2.log("v2 publish through a no-op hook, 2 KiB:   ", hooked);
        console2.log("the hook call itself:                     ", hooked - plain);
        // A cold contract (2,600), the call, the payload copied into memory
        // for it, the selector checked on the way back. The hook's own work
        // comes on top and is the hook's to account for.
        assertLe(hooked - plain, 12_000);
    }

    function test_gas_theHookCallGrowsWithThePayloadItIsHanded() public {
        bytes memory small = _payload(2048);
        bytes memory large = _payload(16_384);
        // Warm with the large payload, and call the hook once, so that this
        // contract's own memory and the hook's address are paid for before
        // anything is measured: what is left is the core's work per call.
        _warm(large);
        _v2Hooked(small);
        uint256 plainSmall = _v2Plain(small);
        uint256 hookedSmall = _v2Hooked(small);
        uint256 plainLarge = _v2Plain(large);
        uint256 hookedLarge = _v2Hooked(large);
        console2.log("hook call overhead, warm hook, 2 KiB:     ", hookedSmall - plainSmall);
        console2.log("hook call overhead, warm hook, 16 KiB:    ", hookedLarge - plainLarge);
        // The payload is copied once more for the hook: 3 gas a word plus
        // memory growth, a few thousand gas for a long letter. Cheap next to
        // the 16 gas a byte the calldata already cost, and worth having —
        // a hook that wants to see the bytes can.
        assertGe(hookedLarge - plainLarge, hookedSmall - plainSmall);
        assertLe(hookedLarge - plainLarge, 20_000);
    }

    function test_gas_aRelayedPostCostsASignatureCheck() public {
        bytes memory payload = _payload(2048);
        _warm(payload);
        uint256 plain = _v2Plain(payload);
        uint256 relayed = _v2Relayed(payload);
        console2.log("v2 publish (plain), 2 KiB:                ", plain);
        console2.log("v2 publishFor (EOA signature), 2 KiB:     ", relayed);
        console2.log("the signature check and the digest:       ", relayed - plain);
        // ecrecover is 3,000; hashing the payload, the struct and the domain
        // and reading the count for the nonce are the rest.
        assertLe(relayed - plain, 12_000);
    }
}
