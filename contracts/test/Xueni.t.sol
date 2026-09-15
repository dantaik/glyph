// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Xueni} from "../src/Xueni.sol";
import {IPublishHook} from "../src/IPublishHook.sol";
import {FeeHook, RecordingHook, ReenteringHook} from "./mocks/Mocks.sol";

/// The core: publishing with and without a hook, what the hook is handed,
/// what happens when it misbehaves, and what the event carries.
contract XueniTest is Test {
    event Post(address indexed author, address indexed hook, uint256 index, uint256 prevBlock, bytes32 title);

    bytes32 constant POST_TOPIC = keccak256("Post(address,address,uint256,uint256,bytes32)");
    bytes32 constant TITLE = bytes32("A letter before the solstice");
    bytes constant PAYLOAD = hex"0b0e804a7573742070726f73652e0a0a54776f20706172616772617068732e0a03";
    /// The plain call's selector, normative in codec/SPEC.md §6: a change
    /// here would silently break every encoder that writes calldata for it.
    bytes4 constant PUBLISH_SELECTOR = 0x70a74532;

    Xueni xueni;
    RecordingHook hook;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        xueni = new Xueni();
        hook = new RecordingHook(xueni);
        vm.roll(100);
    }

    // --- Plain posts -------------------------------------------------------

    function test_plainPostMovesTheHeadAndEmits() public {
        vm.expectEmit(true, true, true, true, address(xueni));
        emit Post(alice, address(0), 0, 0, TITLE);
        vm.prank(alice);
        xueni.publish(TITLE, PAYLOAD);
        assertEq(xueni.count(alice), 1);
        assertEq(xueni.latestBlock(alice), 100);

        vm.roll(150);
        vm.expectEmit(true, true, true, true, address(xueni));
        emit Post(alice, address(0), 1, 100, TITLE);
        vm.prank(alice);
        xueni.publish(TITLE, PAYLOAD);
        assertEq(xueni.count(alice), 2);
        assertEq(xueni.latestBlock(alice), 150);

        assertEq(xueni.count(bob), 0);
        assertEq(xueni.latestBlock(bob), 0);
    }

    function test_twoPostsInOneBlockLinkTheSecondToTheBlockItself() public {
        vm.startPrank(alice);
        xueni.publish(TITLE, PAYLOAD);
        vm.expectEmit(true, true, true, true, address(xueni));
        emit Post(alice, address(0), 1, 100, TITLE);
        xueni.publish(TITLE, PAYLOAD);
        vm.stopPrank();
    }

    function test_everyAuthorIsTheirOwnStream() public {
        vm.prank(alice);
        xueni.publish(TITLE, PAYLOAD);
        vm.roll(110);
        vm.prank(bob);
        xueni.publish(TITLE, PAYLOAD);
        vm.roll(120);
        vm.expectEmit(true, true, true, true, address(xueni));
        emit Post(alice, address(0), 1, 100, TITLE);
        vm.prank(alice);
        xueni.publish(TITLE, PAYLOAD);
        assertEq(xueni.latestBlock(bob), 110);
        assertEq(xueni.count(bob), 1);
    }

    function test_thePlainFormMatchesTheSpecifiedCallData() public {
        bytes memory call = abi.encodeWithSignature("publish(bytes32,bytes)", TITLE, PAYLOAD);
        assertEq(bytes4(call), PUBLISH_SELECTOR);
        assertEq(call, abi.encodePacked(PUBLISH_SELECTOR, abi.encode(TITLE, PAYLOAD)));

        vm.expectEmit(true, true, true, true, address(xueni));
        emit Post(alice, address(0), 0, 0, TITLE);
        vm.prank(alice);
        (bool ok,) = address(xueni).call(call);
        assertTrue(ok);
    }

    function test_thePlainFormTakesNoValue() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(xueni).call{value: 1}(abi.encodeWithSignature("publish(bytes32,bytes)", TITLE, PAYLOAD));
        assertFalse(ok);
        assertEq(xueni.count(alice), 0);
    }

    function test_aZeroHookIsAPlainPost() public {
        vm.expectEmit(true, true, true, true, address(xueni));
        emit Post(alice, address(0), 0, 0, TITLE);
        vm.prank(alice);
        xueni.publish(TITLE, PAYLOAD, address(0), hex"");
        assertEq(xueni.count(alice), 1);
    }

    function test_valueWithNoHookToForwardItToReverts() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(Xueni.ValueWithoutHook.selector);
        xueni.publish{value: 1}(TITLE, PAYLOAD, address(0), hex"");
        assertEq(xueni.count(alice), 0);
        assertEq(address(xueni).balance, 0);
    }

    // --- Hooks --------------------------------------------------------------

    function test_theHookIsHandedEverythingAfterTheEffects() public {
        vm.prank(alice);
        xueni.publish(TITLE, PAYLOAD, address(hook), hex"c0ffee");
        RecordingHook.Call memory c = hook.last();
        assertEq(c.caller, address(xueni));
        assertEq(c.sender, alice);
        assertEq(c.author, alice);
        assertEq(c.index, 0);
        assertEq(c.prevBlock, 0);
        assertEq(c.title, TITLE);
        assertEq(c.payload, PAYLOAD);
        assertEq(c.hookData, hex"c0ffee");
        assertEq(c.value, 0);
        // Effects before the call: the hook already sees the post recorded.
        assertEq(c.countSeen, 1);
        assertEq(c.latestSeen, 100);

        vm.roll(130);
        vm.prank(alice);
        xueni.publish(TITLE, PAYLOAD, address(hook), hex"");
        c = hook.last();
        assertEq(c.index, 1);
        assertEq(c.prevBlock, 100);
        assertEq(c.countSeen, 2);
        assertEq(c.latestSeen, 130);
        assertEq(hook.callCount(), 2);
    }

    function test_theHookIsAnIndexedTopicOfTheEvent() public {
        vm.recordLogs();
        vm.prank(alice);
        xueni.publish(TITLE, PAYLOAD, address(hook), hex"");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertEq(logs[0].emitter, address(xueni));
        assertEq(logs[0].topics.length, 3);
        assertEq(logs[0].topics[0], POST_TOPIC);
        assertEq(logs[0].topics[1], bytes32(uint256(uint160(alice))));
        assertEq(logs[0].topics[2], bytes32(uint256(uint160(address(hook)))));
        (uint256 index, uint256 prevBlock, bytes32 title) = abi.decode(logs[0].data, (uint256, uint256, bytes32));
        assertEq(index, 0);
        assertEq(prevBlock, 0);
        assertEq(title, TITLE);
    }

    function test_theEventIsEmittedBeforeTheHookRuns() public {
        // The hook's own event must come after the core's in the receipt.
        vm.recordLogs();
        ReenteringHook re = new ReenteringHook(xueni);
        vm.prank(alice);
        xueni.publish(TITLE, PAYLOAD, address(re), hex"");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 2);
        assertEq(logs[0].topics[1], bytes32(uint256(uint160(alice))));
        assertEq(logs[1].topics[1], bytes32(uint256(uint160(address(re)))));
    }

    function test_valueIsForwardedToTheHookAndNoneIsKept() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        xueni.publish{value: 0.25 ether}(TITLE, PAYLOAD, address(hook), hex"");
        assertEq(hook.last().value, 0.25 ether);
        assertEq(address(hook).balance, 0.25 ether);
        assertEq(address(xueni).balance, 0);
        assertEq(alice.balance, 0.75 ether);
    }

    function test_aFeeHookGatesOnWhatItIsPaid() public {
        FeeHook fee = new FeeHook(0.01 ether);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FeeHook.FeeNotPaid.selector, 0.01 ether, 0.001 ether));
        xueni.publish{value: 0.001 ether}(TITLE, PAYLOAD, address(fee), hex"");
        assertEq(xueni.count(alice), 0);

        vm.prank(alice);
        xueni.publish{value: 0.01 ether}(TITLE, PAYLOAD, address(fee), hex"");
        assertEq(fee.received(), 0.01 ether);
        assertEq(xueni.count(alice), 1);
    }

    function test_aHookThatRevertsRevertsThePostWithItsOwnReason() public {
        hook.setMode(RecordingHook.Mode.Revert);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RecordingHook.Nope.selector, "hook says no"));
        xueni.publish(TITLE, PAYLOAD, address(hook), hex"");
        assertEq(xueni.count(alice), 0);
        assertEq(xueni.latestBlock(alice), 0);
    }

    function test_aHookThatRejectsValueRevertsThePost() public {
        hook.setMode(RecordingHook.Mode.RejectValue);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RecordingHook.Nope.selector, "no value please"));
        xueni.publish{value: 1}(TITLE, PAYLOAD, address(hook), hex"");
        assertEq(alice.balance, 1 ether);
    }

    function test_aHookReturningTheWrongSelectorIsRejected() public {
        hook.setMode(RecordingHook.Mode.WrongSelector);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Xueni.HookRejected.selector, address(hook), bytes4(0xdeadbeef)));
        xueni.publish(TITLE, PAYLOAD, address(hook), hex"");
        assertEq(xueni.count(alice), 0);
    }

    function test_anAddressWithoutCodeIsNotAHook() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Xueni.NotAHook.selector, bob));
        xueni.publish(TITLE, PAYLOAD, bob, hex"");
    }

    function test_aContractWithoutOnPublishIsRejected() public {
        // The core itself has code but no onPublish: the call reverts.
        vm.prank(alice);
        vm.expectRevert();
        xueni.publish(TITLE, PAYLOAD, address(xueni), hex"");
        assertEq(xueni.count(alice), 0);
    }

    function test_aReenteringHookPublishesAsItselfNotAsTheAuthor() public {
        ReenteringHook re = new ReenteringHook(xueni);
        vm.prank(alice);
        xueni.publish(TITLE, PAYLOAD, address(re), hex"");
        assertEq(xueni.count(alice), 1);
        assertEq(xueni.count(address(re)), 1);
        assertEq(xueni.latestBlock(address(re)), 100);
    }

    function test_theSameHookServesManyAuthors() public {
        vm.prank(alice);
        xueni.publish(TITLE, PAYLOAD, address(hook), hex"01");
        vm.prank(bob);
        xueni.publish(TITLE, PAYLOAD, address(hook), hex"02");
        assertEq(hook.callCount(), 2);
        RecordingHook.Call memory c = hook.last();
        assertEq(c.author, bob);
        assertEq(c.index, 0);
        assertEq(c.hookData, hex"02");
    }

    // --- The chain, under fuzzing -----------------------------------------

    function testFuzz_everyPostLinksToTheAuthorsPreviousBlock(uint8 posts, uint16 gap, bool hooked) public {
        uint256 n = bound(posts, 1, 40);
        uint256 step = bound(gap, 0, 5000);
        uint256 at = 100;
        uint256 prev = 0;
        address h = hooked ? address(hook) : address(0);
        for (uint256 i; i < n; ++i) {
            vm.roll(at);
            vm.expectEmit(true, true, true, true, address(xueni));
            emit Post(alice, h, i, prev, TITLE);
            vm.prank(alice);
            if (hooked) xueni.publish(TITLE, PAYLOAD, h, hex"");
            else xueni.publish(TITLE, PAYLOAD);
            assertEq(xueni.count(alice), i + 1);
            assertEq(xueni.latestBlock(alice), at);
            prev = at;
            at += step;
        }
        if (hooked) assertEq(hook.callCount(), n);
    }

    function testFuzz_hookDataAndPayloadArriveUntouched(bytes calldata payload, bytes calldata hookData, bytes32 title)
        public
    {
        vm.prank(alice);
        xueni.publish(title, payload, address(hook), hookData);
        RecordingHook.Call memory c = hook.last();
        assertEq(c.payload, payload);
        assertEq(c.hookData, hookData);
        assertEq(c.title, title);
    }
}
