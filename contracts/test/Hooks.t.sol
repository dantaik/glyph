// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {GlyphV2} from "../src/GlyphV2.sol";
import {IPublishHook} from "../src/IPublishHook.sol";
import {BasePublishHook} from "../src/hooks/BasePublishHook.sol";
import {IndexHook} from "../src/hooks/IndexHook.sol";
import {MultiHook} from "../src/hooks/MultiHook.sol";
import {PublicationHook} from "../src/hooks/PublicationHook.sol";
import {FeeHook, RecordingHook} from "./mocks/Mocks.sol";

/// The reference hooks: the base contract's guard, the fan-out, the index
/// and the publication — on their own and composed.
contract HooksTest is Test {
    event Indexed(
        bytes32 indexed key,
        address indexed author,
        uint256 keyIndex,
        uint256 prevBlock,
        uint256 authorIndex,
        bytes32 title
    );
    event Published(
        bytes32 indexed id,
        address indexed author,
        uint256 pubIndex,
        uint256 prevBlock,
        uint256 authorIndex,
        bytes32 title
    );
    event Composed(address indexed author, uint256 index, address[] hooks);

    bytes32 constant TITLE = bytes32("The drums");
    bytes constant PAYLOAD = hex"0b0e804a7573742070726f73652e0a0a54776f20706172616772617068732e0a03";
    bytes32 constant INDEXED_TOPIC = keccak256("Indexed(bytes32,address,uint256,uint256,uint256,bytes32)");

    GlyphV2 glyph;
    MultiHook multi;
    IndexHook index;
    PublicationHook pubs;
    RecordingHook rec;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        glyph = new GlyphV2();
        multi = new MultiHook(address(glyph));
        index = new IndexHook(address(glyph), address(multi));
        pubs = new PublicationHook(address(glyph), address(multi));
        rec = new RecordingHook(glyph);
        vm.roll(100);
    }

    function one(address hook, bytes memory data, uint256 value)
        internal
        pure
        returns (address[] memory hooks, bytes[] memory datas, uint256[] memory values)
    {
        hooks = new address[](1);
        datas = new bytes[](1);
        values = new uint256[](1);
        hooks[0] = hook;
        datas[0] = data;
        values[0] = value;
    }

    // --- BasePublishHook --------------------------------------------------------

    function test_theBaseRefusesEveryCallerButTheCoreAndItsComposer() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BasePublishHook.NotGlyph.selector, bob));
        index.onPublish(bob, bob, 0, 0, TITLE, PAYLOAD, hex"");

        // Straight from the core: fine.
        vm.prank(alice);
        glyph.publish(TITLE, PAYLOAD, address(index), hex"");
        assertEq(index.count(index.GLOBAL()), 1);

        // Through the composer it trusts: fine. (The data is built first: a
        // prank is spent by the next call, and encode() is a call.)
        (address[] memory hooks, bytes[] memory datas, uint256[] memory values) = one(address(index), hex"", 0);
        bytes memory data = multi.encode(hooks, datas, values);
        vm.prank(alice);
        glyph.publish(TITLE, PAYLOAD, address(multi), data);
        assertEq(index.count(index.GLOBAL()), 2);
    }

    function test_aHookThatTrustsNoComposerCannotBeComposed() public {
        IndexHook lone = new IndexHook(address(glyph), address(0));
        (address[] memory hooks, bytes[] memory datas, uint256[] memory values) = one(address(lone), hex"", 0);
        bytes memory data = multi.encode(hooks, datas, values);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BasePublishHook.NotGlyph.selector, address(multi)));
        glyph.publish(TITLE, PAYLOAD, address(multi), data);
        // Directly, it still works.
        vm.prank(alice);
        glyph.publish(TITLE, PAYLOAD, address(lone), hex"");
        assertEq(lone.count(lone.GLOBAL()), 1);
    }

    function test_theBaseRefusesValueUnlessTheHookTakesIt() public {
        assertFalse(index.acceptsValue());
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BasePublishHook.UnexpectedValue.selector, 1));
        glyph.publish{value: 1}(TITLE, PAYLOAD, address(index), hex"");
        assertEq(address(index).balance, 0);
        assertEq(glyph.count(alice), 0);
    }

    function test_theBaseAnswersWithTheSelector() public {
        vm.prank(address(glyph));
        bytes4 answer = index.onPublish(alice, alice, 0, 0, TITLE, PAYLOAD, hex"");
        assertEq(answer, IPublishHook.onPublish.selector);
    }

    // --- IndexHook ----------------------------------------------------------------

    function test_theIndexKeepsAGlobalListWhenNoKeysAreGiven() public {
        bytes32 g = index.GLOBAL();
        vm.expectEmit(true, true, true, true, address(index));
        emit Indexed(g, alice, 0, 0, 0, TITLE);
        vm.prank(alice);
        glyph.publish(TITLE, PAYLOAD, address(index), hex"");
        assertEq(index.latestBlock(g), 100);
        assertEq(index.count(g), 1);

        vm.roll(200);
        vm.prank(bob);
        glyph.publish(TITLE, PAYLOAD); // a plain post is not in the index
        vm.expectEmit(true, true, true, true, address(index));
        emit Indexed(g, bob, 1, 100, 1, TITLE);
        vm.prank(bob);
        glyph.publish(TITLE, PAYLOAD, address(index), hex"");
        assertEq(index.latestBlock(g), 200);
        assertEq(index.count(g), 2);
    }

    function test_theIndexFilesUnderEveryKeyGiven() public {
        bytes32 food = index.keyOf("food");
        assertEq(food, keccak256("food"));
        bytes32[] memory keys = new bytes32[](2);
        keys[0] = food;
        keys[1] = index.GLOBAL();
        vm.expectEmit(true, true, true, true, address(index));
        emit Indexed(food, alice, 0, 0, 0, TITLE);
        vm.expectEmit(true, true, true, true, address(index));
        emit Indexed(index.GLOBAL(), alice, 0, 0, 0, TITLE);
        vm.prank(alice);
        glyph.publish(TITLE, PAYLOAD, address(index), abi.encode(keys));
        assertEq(index.count(food), 1);
        assertEq(index.count(index.GLOBAL()), 1);
        assertEq(index.count(keccak256("drink")), 0);
    }

    function test_theIndexBoundsTheKeysPerPost() public {
        bytes32[] memory keys = new bytes32[](17);
        for (uint256 i; i < keys.length; ++i) keys[i] = bytes32(i);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IndexHook.TooManyKeys.selector, 17, 16));
        glyph.publish(TITLE, PAYLOAD, address(index), abi.encode(keys));
        keys = new bytes32[](16);
        for (uint256 i; i < keys.length; ++i) keys[i] = bytes32(i);
        vm.prank(alice);
        glyph.publish(TITLE, PAYLOAD, address(index), abi.encode(keys));
        assertEq(index.count(bytes32(uint256(15))), 1);
    }

    function test_theIndexWalksLikeAnAuthorList() public {
        bytes32 key = index.keyOf("letters");
        bytes32[] memory keys = new bytes32[](1);
        keys[0] = key;
        uint256[3] memory blocks = [uint256(100), 130, 130];
        address[3] memory who = [alice, bob, alice];
        vm.recordLogs();
        for (uint256 i; i < 3; ++i) {
            vm.roll(blocks[i]);
            vm.prank(who[i]);
            glyph.publish(TITLE, PAYLOAD, address(index), abi.encode(keys));
        }
        assertEq(index.latestBlock(key), 130);
        assertEq(index.count(key), 3);
        // Every Indexed entry names the previous entry's block: the walk from
        // latestBlock(key) reads 130 (two entries, the older pointing at 100),
        // then 100, then stops at 0 — single blocks all the way.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 seen;
        uint256 prevExpected;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(index) || logs[i].topics[0] != INDEXED_TOPIC) continue;
            (uint256 keyIndex, uint256 prevBlock,,) = abi.decode(logs[i].data, (uint256, uint256, uint256, bytes32));
            assertEq(keyIndex, seen);
            assertEq(prevBlock, prevExpected);
            prevExpected = blocks[seen];
            seen += 1;
        }
        assertEq(seen, 3);
    }

    // --- MultiHook --------------------------------------------------------------------

    function test_theFanOutCallsEveryHookInOrderWithItsShareOfTheValue() public {
        FeeHook fee = new FeeHook(0.01 ether);
        address[] memory hooks = new address[](2);
        bytes[] memory datas = new bytes[](2);
        uint256[] memory values = new uint256[](2);
        hooks[0] = address(rec);
        hooks[1] = address(fee);
        datas[0] = hex"aa";
        datas[1] = hex"";
        values[0] = 0;
        values[1] = 0.01 ether;
        bytes memory data = multi.encode(hooks, datas, values);
        assertEq(data, abi.encode(hooks, datas, values));

        vm.deal(alice, 1 ether);
        vm.expectEmit(true, true, true, true, address(multi));
        emit Composed(alice, 0, hooks);
        vm.prank(alice);
        glyph.publish{value: 0.01 ether}(TITLE, PAYLOAD, address(multi), data);

        RecordingHook.Call memory c = rec.last();
        assertEq(c.caller, address(multi));
        assertEq(c.sender, alice);
        assertEq(c.author, alice);
        assertEq(c.index, 0);
        assertEq(c.title, TITLE);
        assertEq(c.payload, PAYLOAD);
        assertEq(c.hookData, hex"aa");
        assertEq(c.value, 0);
        assertEq(fee.received(), 0.01 ether);
        assertEq(address(multi).balance, 0);
        assertEq(address(glyph).balance, 0);
    }

    function test_theFanOutRefusesMismatchedShapes() public {
        address[] memory hooks = new address[](1);
        hooks[0] = address(rec);
        bytes[] memory datas = new bytes[](2);
        uint256[] memory values = new uint256[](1);
        vm.prank(alice);
        vm.expectRevert(MultiHook.LengthMismatch.selector);
        glyph.publish(TITLE, PAYLOAD, address(multi), abi.encode(hooks, datas, values));

        vm.prank(alice);
        vm.expectRevert(MultiHook.NoHooks.selector);
        glyph.publish(TITLE, PAYLOAD, address(multi), abi.encode(new address[](0), new bytes[](0), new uint256[](0)));

        datas = new bytes[](1);
        values[0] = 5;
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MultiHook.ValueMismatch.selector, 5, 4));
        glyph.publish{value: 4}(TITLE, PAYLOAD, address(multi), abi.encode(hooks, datas, values));
        assertEq(glyph.count(alice), 0);
    }

    function test_theFanOutRefusesWhatTheCoreWouldRefuse() public {
        (address[] memory hooks, bytes[] memory datas, uint256[] memory values) = one(bob, hex"", 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MultiHook.NotAHook.selector, bob));
        glyph.publish(TITLE, PAYLOAD, address(multi), abi.encode(hooks, datas, values));

        rec.setMode(RecordingHook.Mode.WrongSelector);
        (hooks, datas, values) = one(address(rec), hex"", 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MultiHook.HookRejected.selector, address(rec), bytes4(0xdeadbeef)));
        glyph.publish(TITLE, PAYLOAD, address(multi), abi.encode(hooks, datas, values));

        rec.setMode(RecordingHook.Mode.Revert);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RecordingHook.Nope.selector, "hook says no"));
        glyph.publish(TITLE, PAYLOAD, address(multi), abi.encode(hooks, datas, values));
        assertEq(glyph.count(alice), 0);
    }

    function test_theFanOutTakesCallsFromTheCoreOnly() public {
        (address[] memory hooks, bytes[] memory datas, uint256[] memory values) = one(address(rec), hex"", 0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MultiHook.NotGlyph.selector, bob));
        multi.onPublish(bob, bob, 0, 0, TITLE, PAYLOAD, abi.encode(hooks, datas, values));
        assertEq(rec.callCount(), 0);
    }

    function test_theSameHookTwiceIsCalledTwice() public {
        address[] memory hooks = new address[](2);
        hooks[0] = address(rec);
        hooks[1] = address(rec);
        bytes[] memory datas = new bytes[](2);
        datas[0] = hex"01";
        datas[1] = hex"02";
        uint256[] memory values = new uint256[](2);
        vm.prank(alice);
        glyph.publish(TITLE, PAYLOAD, address(multi), abi.encode(hooks, datas, values));
        assertEq(rec.callCount(), 2);
        assertEq(rec.last().hookData, hex"02");
    }

    // --- PublicationHook ---------------------------------------------------------------

    function test_aPublicationIsCreatedAndItsOwnerPostsIntoIt() public {
        vm.prank(alice);
        bytes32 id = pubs.create("Letters home");
        assertEq(id, pubs.idOf("Letters home"));
        (address owner, bool open, uint256 latest, uint256 n) = pubs.publication(id);
        assertEq(owner, alice);
        assertFalse(open);
        assertEq(latest, 0);
        assertEq(n, 0);

        vm.expectEmit(true, true, true, true, address(pubs));
        emit Published(id, alice, 0, 0, 0, TITLE);
        vm.prank(alice);
        glyph.publish(TITLE, PAYLOAD, address(pubs), abi.encode(id));
        (,, latest, n) = pubs.publication(id);
        assertEq(latest, 100);
        assertEq(n, 1);
    }

    function test_membershipIsTheDoor() public {
        vm.prank(alice);
        bytes32 id = pubs.create("Letters home");

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PublicationHook.NotMember.selector, id, bob));
        glyph.publish(TITLE, PAYLOAD, address(pubs), abi.encode(id));

        vm.prank(alice);
        pubs.setMember(id, bob, true);
        assertTrue(pubs.isMember(id, bob));
        vm.expectEmit(true, true, true, true, address(pubs));
        emit Published(id, bob, 0, 0, 0, TITLE);
        vm.prank(bob);
        glyph.publish(TITLE, PAYLOAD, address(pubs), abi.encode(id));

        vm.prank(alice);
        pubs.setMember(id, bob, false);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PublicationHook.NotMember.selector, id, bob));
        glyph.publish(TITLE, PAYLOAD, address(pubs), abi.encode(id));
        // The refused post never happened, in the core or in the hook.
        assertEq(glyph.count(bob), 1);
        (,,, uint256 n) = pubs.publication(id);
        assertEq(n, 1);
    }

    function test_anOpenPublicationTakesAnyone() public {
        vm.prank(alice);
        bytes32 id = pubs.create("Open letters");
        vm.prank(alice);
        pubs.setOpen(id, true);
        vm.prank(carol);
        glyph.publish(TITLE, PAYLOAD, address(pubs), abi.encode(id));
        vm.prank(alice);
        pubs.setOpen(id, false);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(PublicationHook.NotMember.selector, id, carol));
        glyph.publish(TITLE, PAYLOAD, address(pubs), abi.encode(id));
    }

    function test_onlyTheOwnerManagesAndOwnershipMoves() public {
        vm.prank(alice);
        bytes32 id = pubs.create("Letters home");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PublicationHook.NotOwner.selector, id, bob));
        pubs.setMember(id, bob, true);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PublicationHook.NotOwner.selector, id, bob));
        pubs.setOpen(id, true);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PublicationHook.NotOwner.selector, id, bob));
        pubs.transfer(id, bob);

        vm.prank(alice);
        pubs.transfer(id, bob);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PublicationHook.NotOwner.selector, id, alice));
        pubs.setMember(id, carol, true);
        vm.prank(bob);
        pubs.setMember(id, carol, true);
        // The old owner is not a member by default any more.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PublicationHook.NotMember.selector, id, alice));
        glyph.publish(TITLE, PAYLOAD, address(pubs), abi.encode(id));
        vm.prank(bob);
        glyph.publish(TITLE, PAYLOAD, address(pubs), abi.encode(id));
    }

    function test_unknownAndMalformedPublicationsAreRefused() public {
        bytes32 nowhere = keccak256("nowhere");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PublicationHook.NoSuchPublication.selector, nowhere));
        glyph.publish(TITLE, PAYLOAD, address(pubs), abi.encode(nowhere));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PublicationHook.NoSuchPublication.selector, nowhere));
        pubs.setOpen(nowhere, true);
        // No data at all: not even an id.
        vm.prank(alice);
        vm.expectRevert();
        glyph.publish(TITLE, PAYLOAD, address(pubs), hex"");
        assertEq(glyph.count(alice), 0);
    }

    function test_namesAreFirstComeAndNeverEmpty() public {
        vm.prank(alice);
        bytes32 id = pubs.create("Letters home");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PublicationHook.Exists.selector, id));
        pubs.create("Letters home");
        vm.prank(bob);
        vm.expectRevert(PublicationHook.EmptyName.selector);
        pubs.create("");
    }

    function test_thePublicationListLinksItsPosts() public {
        vm.prank(alice);
        bytes32 id = pubs.create("Letters home");
        vm.prank(alice);
        pubs.setMember(id, bob, true);

        vm.prank(alice);
        glyph.publish(TITLE, PAYLOAD, address(pubs), abi.encode(id));
        vm.roll(150);
        vm.expectEmit(true, true, true, true, address(pubs));
        emit Published(id, bob, 1, 100, 0, TITLE);
        vm.prank(bob);
        glyph.publish(TITLE, PAYLOAD, address(pubs), abi.encode(id));
        vm.roll(170);
        vm.expectEmit(true, true, true, true, address(pubs));
        emit Published(id, alice, 2, 150, 1, TITLE);
        vm.prank(alice);
        glyph.publish(TITLE, PAYLOAD, address(pubs), abi.encode(id));
        (,, uint256 latest, uint256 n) = pubs.publication(id);
        assertEq(latest, 170);
        assertEq(n, 3);
    }

    function test_aRelayedPostIsGatedOnTheSignerNotTheRelayer() public {
        uint256 key = 0xA11CE;
        address signer = vm.addr(key);
        address relayer = makeAddr("relayer");
        vm.prank(alice);
        bytes32 id = pubs.create("Letters home");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory data = abi.encode(id);
        bytes32 digest = glyph.publishDigest(signer, TITLE, keccak256(PAYLOAD), address(pubs), keccak256(data), 0, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        // The relayer being a member is no help.
        vm.prank(alice);
        pubs.setMember(id, relayer, true);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(PublicationHook.NotMember.selector, id, signer));
        glyph.publishFor(signer, TITLE, PAYLOAD, address(pubs), data, deadline, sig);

        vm.prank(alice);
        pubs.setMember(id, signer, true);
        vm.expectEmit(true, true, true, true, address(pubs));
        emit Published(id, signer, 0, 0, 0, TITLE);
        vm.prank(relayer);
        glyph.publishFor(signer, TITLE, PAYLOAD, address(pubs), data, deadline, sig);
    }

    // --- Composed ----------------------------------------------------------------------

    function test_aPublicationAndTheIndexTogether() public {
        vm.prank(alice);
        bytes32 id = pubs.create("Letters home");
        bytes32 key = index.keyOf("letters");
        bytes32[] memory keys = new bytes32[](1);
        keys[0] = key;
        address[] memory hooks = new address[](2);
        hooks[0] = address(pubs);
        hooks[1] = address(index);
        bytes[] memory datas = new bytes[](2);
        datas[0] = abi.encode(id);
        datas[1] = abi.encode(keys);
        uint256[] memory values = new uint256[](2);
        bytes memory data = multi.encode(hooks, datas, values);

        vm.expectEmit(true, true, true, true, address(pubs));
        emit Published(id, alice, 0, 0, 0, TITLE);
        vm.expectEmit(true, true, true, true, address(index));
        emit Indexed(key, alice, 0, 0, 0, TITLE);
        vm.expectEmit(true, true, true, true, address(multi));
        emit Composed(alice, 0, hooks);
        vm.prank(alice);
        glyph.publish(TITLE, PAYLOAD, address(multi), data);

        // A non-member fails the publication, and nothing of the index moves.
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PublicationHook.NotMember.selector, id, bob));
        glyph.publish(TITLE, PAYLOAD, address(multi), data);
        assertEq(index.count(key), 1);
        assertEq(glyph.count(bob), 0);
    }
}
