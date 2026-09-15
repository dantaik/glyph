// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Xueni} from "../src/Xueni.sol";
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

/// @dev Measures from inside a contract of its own, in one call per
///      measurement, so that the numbers are the core's own work and nothing
///      else — whether or not the test runner wraps each top-level call in a
///      transaction of its own (Foundry does by default since 1.8 and did
///      not before; the difference is 21,000 gas plus the calldata, which
///      says nothing about the contract). The probe is the author of the
///      plain and hooked posts; a relayed post is signed by an account whose
///      key the test holds.
contract GasProbe {
    Xueni internal immutable xueni;
    address internal immutable hook;

    constructor(Xueni xueni_, address hook_) {
        xueni = xueni_;
        hook = hook_;
    }

    /// One post first, so that the author's slot, the contract and the
    /// memory are warm; then the author's second post, measured.
    function plain(bytes32 title, bytes calldata payload) external returns (uint256 used) {
        xueni.publish(title, payload);
        uint256 g = gasleft();
        xueni.publish(title, payload);
        used = g - gasleft();
    }

    /// A plain post and a post through the hook, the hook still cold — as it
    /// is in a real transaction.
    function hooked(bytes32 title, bytes calldata payload) external returns (uint256 plainUsed, uint256 hookedUsed) {
        xueni.publish(title, payload);
        uint256 g = gasleft();
        xueni.publish(title, payload);
        plainUsed = g - gasleft();
        g = gasleft();
        xueni.publish(title, payload, hook, "");
        hookedUsed = g - gasleft();
    }

    /// The hook call's overhead at two payload sizes, everything warm —
    /// the hook included — so that what is left is the copy of the payload.
    function hookedSizes(bytes32 title, bytes calldata small, bytes calldata large)
        external
        returns (uint256 plainSmall, uint256 hookedSmall, uint256 plainLarge, uint256 hookedLarge)
    {
        xueni.publish(title, large);
        xueni.publish(title, small, hook, "");
        uint256 g = gasleft();
        xueni.publish(title, small);
        plainSmall = g - gasleft();
        g = gasleft();
        xueni.publish(title, small, hook, "");
        hookedSmall = g - gasleft();
        g = gasleft();
        xueni.publish(title, large);
        plainLarge = g - gasleft();
        g = gasleft();
        xueni.publish(title, large, hook, "");
        hookedLarge = g - gasleft();
    }

    /// The probe's second plain post against the signer's second relayed
    /// post: `first` lands the signer's post #0 so that their slot is as
    /// warm and as non-zero as the probe's own when `second` (#1) is timed.
    function relayed(
        address author,
        bytes32 title,
        bytes calldata payload,
        uint256 deadline,
        bytes calldata first,
        bytes calldata second
    ) external returns (uint256 plainUsed, uint256 relayedUsed) {
        xueni.publish(title, payload);
        xueni.publishFor(author, title, payload, address(0), "", deadline, first);
        uint256 g = gasleft();
        xueni.publish(title, payload);
        plainUsed = g - gasleft();
        g = gasleft();
        xueni.publishFor(author, title, payload, address(0), "", deadline, second);
        relayedUsed = g - gasleft();
    }
}

/// @title What a post costs the contract.
/// @notice Steady-state numbers: an author's second post, with the slot and
///         the contract already touched, so what is measured is the
///         contract's own work. A real transaction adds the same 21,000
///         base, the same calldata and the same cold-access charges to every
///         one of these, and under EIP-7623 the calldata floor (10 gas per
///         token) usually swallows the whole execution anyway — see
///         xueni-spec §4.
///
///         The bounds are regression guards, not targets: a change that
///         makes a plain post, a hook call or a relayed post cost more than
///         it does today is a change somebody should have to explain.
contract GasTest is Test {
    Xueni internal xueni;
    NoopHook internal hook;
    GasProbe internal probe;

    uint256 internal constant PK = 0xA11CE;
    address internal author;
    bytes32 internal constant TITLE = bytes32("A letter before the solstice");

    function setUp() public {
        xueni = new Xueni();
        hook = new NoopHook();
        probe = new GasProbe(xueni, address(hook));
        author = vm.addr(PK);
    }

    /// A payload of the given size with no zero bytes, as compressed text has none.
    function _payload(uint256 size) internal pure returns (bytes memory p) {
        p = new bytes(size);
        for (uint256 i = 0; i < size; i++) {
            p[i] = bytes1(uint8(0x21 + (i % 90)));
        }
    }

    /// The author's signature for their post `index`, plain, with `payload`.
    function _signed(bytes memory payload, uint256 index, uint256 deadline) internal view returns (bytes memory) {
        bytes32 digest = xueni.publishDigest(author, TITLE, keccak256(payload), address(0), keccak256(""), index, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_gas_aPlainPostStaysWithinItsBudget() public {
        uint256 used = probe.plain(TITLE, _payload(2048));
        console2.log("publish (plain), 2 KiB payload, warm:     ", used);
        // A warm plain post is the event (LOG3 with 96 bytes of data: 375 +
        // 3 x 375 + 8 x 96 = 2,268), the packed slot read and written warm
        // (200), the dispatch, the zero-hook and no-value checks, and the
        // plumbing into the shared `_publish`. Measured at 4,776; anything
        // past 5,200 is new work that should be explained.
        assertLe(used, 5_200);
    }

    function test_gas_aHookCallIsABoundedOverheadOnThePost() public {
        (uint256 plainUsed, uint256 hookedUsed) = probe.hooked(TITLE, _payload(2048));
        console2.log("publish (plain), 2 KiB:                ", plainUsed);
        console2.log("publish through a no-op hook, 2 KiB:   ", hookedUsed);
        console2.log("the hook call itself:                     ", hookedUsed - plainUsed);
        // A cold contract (2,600), the call, the payload copied into memory
        // for it, the selector checked on the way back. The hook's own work
        // comes on top and is the hook's to account for.
        assertLe(hookedUsed - plainUsed, 12_000);
    }

    function test_gas_theHookCallGrowsWithThePayloadItIsHanded() public {
        (uint256 plainSmall, uint256 hookedSmall, uint256 plainLarge, uint256 hookedLarge) =
            probe.hookedSizes(TITLE, _payload(2048), _payload(16_384));
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
        uint256 deadline = block.timestamp + 1 days;
        (uint256 plainUsed, uint256 relayedUsed) =
            probe.relayed(author, TITLE, payload, deadline, _signed(payload, 0, deadline), _signed(payload, 1, deadline));
        console2.log("publish (plain), 2 KiB:                ", plainUsed);
        console2.log("publishFor (EOA signature), 2 KiB:     ", relayedUsed);
        console2.log("the signature check and the digest:       ", relayedUsed - plainUsed);
        // ecrecover is 3,000; hashing the payload, the struct and the domain
        // and reading the count for the nonce are the rest.
        assertLe(relayedUsed - plainUsed, 12_000);
    }
}
