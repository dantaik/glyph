// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Xueni} from "../src/Xueni.sol";
import {RecordingHook, SmartWallet} from "./mocks/Mocks.sol";

/// Publishing on someone's behalf: the signature, what it covers, how it
/// expires, how it is spent, and who may make one.
contract PublishForTest is Test {
    event Post(address indexed author, address indexed hook, uint256 index, uint256 prevBlock, bytes32 title);

    bytes32 constant TYPEHASH = keccak256(
        "Publish(address author,bytes32 title,bytes32 payloadHash,address hook,bytes32 hookDataHash,uint256 index,uint256 deadline)"
    );
    bytes32 constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    uint256 constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    uint256 constant HALF = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    bytes32 constant TITLE = bytes32("Rain at midnight");
    bytes constant PAYLOAD = hex"0b0e804a7573742070726f73652e0a0a54776f20706172616772617068732e0a03";

    Xueni xueni;
    RecordingHook hook;
    uint256 authorKey = 0xA11CE;
    address author;
    address relayer = makeAddr("relayer");
    uint256 deadline;

    function setUp() public {
        xueni = new Xueni();
        hook = new RecordingHook(xueni);
        author = vm.addr(authorKey);
        vm.roll(100);
        vm.warp(1_000_000);
        deadline = block.timestamp + 1 days;
    }

    // --- Helpers, independent of the contract's own digest code ------------

    function domain() internal view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("Xueni"), keccak256("1"), block.chainid, address(xueni))
        );
    }

    function digestOf(
        address a,
        bytes32 title,
        bytes memory payload,
        address h,
        bytes memory data,
        uint256 index,
        uint256 dl
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domain(),
                keccak256(abi.encode(TYPEHASH, a, title, keccak256(payload), h, keccak256(data), index, dl))
            )
        );
    }

    function sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// The author's signature for a plain post at `index`.
    function plainSig(uint256 index) internal view returns (bytes memory) {
        return sign(authorKey, digestOf(author, TITLE, PAYLOAD, address(0), hex"", index, deadline));
    }

    function relay(bytes memory sig) internal {
        vm.prank(relayer);
        xueni.publishFor(author, TITLE, PAYLOAD, address(0), hex"", deadline, sig);
    }

    // --- The digest ----------------------------------------------------------

    function test_theDomainAndDigestAreTheSpecifiedOnes() public view {
        assertEq(xueni.DOMAIN_SEPARATOR(), domain());
        assertEq(xueni.PUBLISH_TYPEHASH(), TYPEHASH);
        assertEq(
            xueni.publishDigest(author, TITLE, keccak256(PAYLOAD), address(hook), keccak256(hex"c0ffee"), 7, deadline),
            digestOf(author, TITLE, PAYLOAD, address(hook), hex"c0ffee", 7, deadline)
        );
        (bytes1 fields, string memory name, string memory version, uint256 chainId, address verifying,,) =
            xueni.eip712Domain();
        assertEq(fields, hex"0f");
        assertEq(name, "Xueni");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifying, address(xueni));
    }

    // --- The happy path -------------------------------------------------------

    function test_aRelayedPostIsRecordedUnderTheSigner() public {
        vm.expectEmit(true, true, true, true, address(xueni));
        emit Post(author, address(0), 0, 0, TITLE);
        relay(plainSig(0));
        assertEq(xueni.count(author), 1);
        assertEq(xueni.latestBlock(author), 100);
        assertEq(xueni.count(relayer), 0);
    }

    function test_relayedPostsChainLikeAnyOther() public {
        relay(plainSig(0));
        vm.roll(140);
        vm.expectEmit(true, true, true, true, address(xueni));
        emit Post(author, address(0), 1, 100, TITLE);
        relay(plainSig(1));
        // ...and mix with the author's own posts.
        vm.roll(180);
        vm.expectEmit(true, true, true, true, address(xueni));
        emit Post(author, address(0), 2, 140, TITLE);
        vm.prank(author);
        xueni.publish(TITLE, PAYLOAD);
        assertEq(xueni.count(author), 3);
    }

    function test_theAuthorMayRelayTheirOwnPost() public {
        bytes memory sig = plainSig(0);
        vm.prank(author);
        xueni.publishFor(author, TITLE, PAYLOAD, address(0), hex"", deadline, sig);
        assertEq(xueni.count(author), 1);
    }

    function test_anyoneMayRelay() public {
        bytes memory sig = plainSig(0);
        vm.prank(makeAddr("someone else entirely"));
        xueni.publishFor(author, TITLE, PAYLOAD, address(0), hex"", deadline, sig);
        assertEq(xueni.count(author), 1);
    }

    // --- The nonce is the author's next index --------------------------------

    function test_aSignatureIsSpentByThePostItLands() public {
        bytes memory sig = plainSig(0);
        relay(sig);
        vm.expectRevert(Xueni.InvalidSignature.selector);
        relay(sig);
        assertEq(xueni.count(author), 1);
    }

    function test_signaturesLandInOrder() public {
        bytes memory first = plainSig(0);
        bytes memory second = plainSig(1);
        vm.expectRevert(Xueni.InvalidSignature.selector);
        relay(second);
        relay(first);
        relay(second);
        assertEq(xueni.count(author), 2);
    }

    function test_theAuthorCancelsAnUnsentSignatureByPublishingAnything() public {
        bytes memory sig = plainSig(0);
        vm.prank(author);
        xueni.publish(bytes32("something else"), hex"3b");
        vm.expectRevert(Xueni.InvalidSignature.selector);
        relay(sig);
        assertEq(xueni.count(author), 1);
    }

    // --- What the signature covers -------------------------------------------

    function test_everythingTheRelayerCouldVaryIsSigned() public {
        bytes memory sig = sign(authorKey, digestOf(author, TITLE, PAYLOAD, address(hook), hex"c0ffee", 0, deadline));

        vm.startPrank(relayer);
        vm.expectRevert(Xueni.InvalidSignature.selector);
        xueni.publishFor(author, bytes32("another title"), PAYLOAD, address(hook), hex"c0ffee", deadline, sig);
        vm.expectRevert(Xueni.InvalidSignature.selector);
        xueni.publishFor(author, TITLE, hex"3b", address(hook), hex"c0ffee", deadline, sig);
        vm.expectRevert(Xueni.InvalidSignature.selector);
        xueni.publishFor(author, TITLE, PAYLOAD, address(0), hex"c0ffee", deadline, sig);
        vm.expectRevert(Xueni.InvalidSignature.selector);
        xueni.publishFor(author, TITLE, PAYLOAD, address(hook), hex"c0ffef", deadline, sig);
        vm.expectRevert(Xueni.InvalidSignature.selector);
        xueni.publishFor(author, TITLE, PAYLOAD, address(hook), hex"c0ffee", deadline + 1, sig);
        vm.expectRevert(Xueni.InvalidSignature.selector);
        xueni.publishFor(relayer, TITLE, PAYLOAD, address(hook), hex"c0ffee", deadline, sig);
        // Exactly what was signed lands.
        xueni.publishFor(author, TITLE, PAYLOAD, address(hook), hex"c0ffee", deadline, sig);
        vm.stopPrank();
        assertEq(xueni.count(author), 1);
        assertEq(hook.last().hookData, hex"c0ffee");
    }

    function test_anExpiredSignatureIsRefused() public {
        bytes memory sig = plainSig(0);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(Xueni.SignatureExpired.selector, deadline));
        relay(sig);
        // The deadline itself is still good.
        vm.warp(deadline);
        relay(sig);
        assertEq(xueni.count(author), 1);
    }

    function test_aSignatureDoesNotCrossChains() public {
        bytes memory sig = plainSig(0);
        bytes32 before = xueni.DOMAIN_SEPARATOR();
        vm.chainId(167000);
        assertTrue(xueni.DOMAIN_SEPARATOR() != before);
        assertEq(xueni.DOMAIN_SEPARATOR(), domain());
        vm.expectRevert(Xueni.InvalidSignature.selector);
        relay(sig);
        // Signed under the new domain, it lands.
        relay(plainSig(0));
        assertEq(xueni.count(author), 1);
    }

    // --- The hook and the relayer ----------------------------------------------

    function test_theHookSeesTheRelayerAsSenderAndTheSignerAsAuthor() public {
        bytes memory sig = sign(authorKey, digestOf(author, TITLE, PAYLOAD, address(hook), hex"01", 0, deadline));
        vm.deal(relayer, 1 ether);
        vm.prank(relayer);
        xueni.publishFor{value: 0.1 ether}(author, TITLE, PAYLOAD, address(hook), hex"01", deadline, sig);
        RecordingHook.Call memory c = hook.last();
        assertEq(c.caller, address(xueni));
        assertEq(c.sender, relayer);
        assertEq(c.author, author);
        assertEq(c.index, 0);
        assertEq(c.value, 0.1 ether);
        assertEq(c.countSeen, 1);
        assertEq(address(hook).balance, 0.1 ether);
        assertEq(address(xueni).balance, 0);
    }

    function test_valueWithNoHookRevertsForARelayedPostToo() public {
        bytes memory sig = plainSig(0);
        vm.deal(relayer, 1 ether);
        vm.prank(relayer);
        vm.expectRevert(Xueni.ValueWithoutHook.selector);
        xueni.publishFor{value: 1}(author, TITLE, PAYLOAD, address(0), hex"", deadline, sig);
    }

    // --- Signature forms and forgeries -----------------------------------------

    function test_aCompactSignatureIsAccepted() public {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(authorKey, digestOf(author, TITLE, PAYLOAD, address(0), hex"", 0, deadline));
        bytes32 vs = bytes32(uint256(s) | (uint256(v - 27) << 255));
        bytes memory compact = abi.encodePacked(r, vs);
        assertEq(compact.length, 64);
        relay(compact);
        assertEq(xueni.count(author), 1);
    }

    function test_theMalleatedTwinOfASignatureIsRefused() public {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(authorKey, digestOf(author, TITLE, PAYLOAD, address(0), hex"", 0, deadline));
        // ecrecover accepts both (r, s, v) and (r, N - s, v ^ 1); the contract
        // takes only the one with the low s, whichever of the two that is.
        (bytes32 lowS, uint8 lowV, bytes32 highS, uint8 highV) = uint256(s) <= HALF
            ? (s, v, bytes32(N - uint256(s)), v == 27 ? 28 : 27)
            : (bytes32(N - uint256(s)), v == 27 ? 28 : 27, s, v);
        vm.expectRevert(Xueni.InvalidSignature.selector);
        relay(abi.encodePacked(r, highS, highV));
        relay(abi.encodePacked(r, lowS, lowV));
        assertEq(xueni.count(author), 1);
    }

    function test_somebodyElsesSignatureIsRefused() public {
        bytes memory sig = sign(0xB0B, digestOf(author, TITLE, PAYLOAD, address(0), hex"", 0, deadline));
        vm.expectRevert(Xueni.InvalidSignature.selector);
        relay(sig);
    }

    function test_garbageIsRefused() public {
        vm.expectRevert(Xueni.InvalidSignature.selector);
        relay(hex"");
        vm.expectRevert(Xueni.InvalidSignature.selector);
        relay(hex"0102030405060708090a");
        vm.expectRevert(Xueni.InvalidSignature.selector);
        relay(new bytes(65)); // ecrecover answers the zero address
        (, bytes32 r, bytes32 s) = vm.sign(authorKey, digestOf(author, TITLE, PAYLOAD, address(0), hex"", 0, deadline));
        vm.expectRevert(Xueni.InvalidSignature.selector);
        relay(abi.encodePacked(r, s, uint8(5))); // a v that is neither 27 nor 28
        vm.expectRevert(Xueni.InvalidSignature.selector);
        relay(abi.encodePacked(r, s, uint8(27), uint8(0))); // 66 bytes
        assertEq(xueni.count(author), 0);
    }

    function test_anAddressWithCodeStillSignsWithItsKey() public {
        // The shape of an EIP-7702 delegated wallet: code at the address, and
        // a key that signs. ecrecover is tried first, so ERC-1271 never runs.
        vm.etch(author, hex"00");
        relay(plainSig(0));
        assertEq(xueni.count(author), 1);
    }

    // --- Contract accounts ------------------------------------------------------

    function test_aContractAccountSignsThroughErc1271() public {
        uint256 ownerKey = 0x0770;
        SmartWallet wallet = new SmartWallet(vm.addr(ownerKey));
        bytes memory sig = sign(ownerKey, digestOf(address(wallet), TITLE, PAYLOAD, address(0), hex"", 0, deadline));

        vm.expectEmit(true, true, true, true, address(xueni));
        emit Post(address(wallet), address(0), 0, 0, TITLE);
        vm.prank(relayer);
        xueni.publishFor(address(wallet), TITLE, PAYLOAD, address(0), hex"", deadline, sig);
        assertEq(xueni.count(address(wallet)), 1);

        // Spent, like any other signature: the index moved on.
        vm.prank(relayer);
        vm.expectRevert(Xueni.InvalidSignature.selector);
        xueni.publishFor(address(wallet), TITLE, PAYLOAD, address(0), hex"", deadline, sig);
    }

    function test_aContractAccountThatDoesNotSayYesIsRefused() public {
        uint256 ownerKey = 0x0770;
        SmartWallet wallet = new SmartWallet(vm.addr(ownerKey));
        bytes memory sig = sign(ownerKey, digestOf(address(wallet), TITLE, PAYLOAD, address(0), hex"", 0, deadline));
        bytes memory wrong = sign(0xBAD, digestOf(address(wallet), TITLE, PAYLOAD, address(0), hex"", 0, deadline));

        vm.startPrank(relayer);
        // Not the wallet's owner.
        vm.expectRevert(Xueni.InvalidSignature.selector);
        xueni.publishFor(address(wallet), TITLE, PAYLOAD, address(0), hex"", deadline, wrong);
        // The wrong magic value.
        wallet.setWrongMagic(true);
        vm.expectRevert(Xueni.InvalidSignature.selector);
        xueni.publishFor(address(wallet), TITLE, PAYLOAD, address(0), hex"", deadline, sig);
        wallet.setWrongMagic(false);
        // A wallet that reverts.
        wallet.setBroken(true);
        vm.expectRevert(Xueni.InvalidSignature.selector);
        xueni.publishFor(address(wallet), TITLE, PAYLOAD, address(0), hex"", deadline, sig);
        wallet.setBroken(false);
        // A contract with no isValidSignature at all.
        vm.expectRevert(Xueni.InvalidSignature.selector);
        xueni.publishFor(address(hook), TITLE, PAYLOAD, address(0), hex"", deadline, sig);
        // Fixed, it signs.
        xueni.publishFor(address(wallet), TITLE, PAYLOAD, address(0), hex"", deadline, sig);
        vm.stopPrank();
        assertEq(xueni.count(address(wallet)), 1);
    }

    // --- Under fuzzing -----------------------------------------------------------

    function testFuzz_onlyTheSignedPostLands(bytes32 title, bytes calldata payload, bytes calldata data, uint64 ttl)
        public
    {
        uint256 dl = block.timestamp + bound(ttl, 0, 365 days);
        bytes memory sig = sign(authorKey, digestOf(author, title, payload, address(hook), data, 0, dl));
        vm.prank(relayer);
        xueni.publishFor(author, title, payload, address(hook), data, dl, sig);
        RecordingHook.Call memory c = hook.last();
        assertEq(c.author, author);
        assertEq(c.sender, relayer);
        assertEq(c.title, title);
        assertEq(c.payload, payload);
        assertEq(c.hookData, data);
        // And not again.
        vm.prank(relayer);
        vm.expectRevert(Xueni.InvalidSignature.selector);
        xueni.publishFor(author, title, payload, address(hook), data, dl, sig);
    }

    function testFuzz_aSignatureForAnotherIndexNeverLands(uint8 signedIndex, uint8 posted) public {
        uint256 have = bound(posted, 0, 12);
        uint256 signedFor = bound(signedIndex, 0, 24);
        for (uint256 i; i < have; ++i) {
            vm.prank(author);
            xueni.publish(TITLE, PAYLOAD);
        }
        bytes memory sig = plainSig(signedFor);
        if (signedFor == have) {
            relay(sig);
            assertEq(xueni.count(author), have + 1);
        } else {
            vm.expectRevert(Xueni.InvalidSignature.selector);
            relay(sig);
            assertEq(xueni.count(author), have);
        }
    }
}
