// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPublishHook} from "../../src/IPublishHook.sol";
import {GlyphV2} from "../../src/GlyphV2.sol";

/// A hook that records exactly what it was called with, and can be told to
/// misbehave in each of the ways the core has to catch.
contract RecordingHook is IPublishHook {
    struct Call {
        address caller;
        address sender;
        address author;
        uint256 index;
        uint256 prevBlock;
        bytes32 title;
        bytes payload;
        bytes hookData;
        uint256 value;
        uint256 countSeen; // glyph.count(author) at the time of the call
        uint256 latestSeen; // glyph.latestBlock(author) at the time of the call
    }

    enum Mode {
        Ok,
        WrongSelector,
        Revert,
        RejectValue
    }

    error Nope(string why);

    GlyphV2 public immutable glyph;
    Mode public mode;
    Call[] internal _calls;

    constructor(GlyphV2 glyph_) {
        glyph = glyph_;
    }

    function setMode(Mode m) external {
        mode = m;
    }

    function callCount() external view returns (uint256) {
        return _calls.length;
    }

    function last() external view returns (Call memory) {
        return _calls[_calls.length - 1];
    }

    function onPublish(
        address sender,
        address author,
        uint256 index,
        uint256 prevBlock,
        bytes32 title,
        bytes calldata payload,
        bytes calldata hookData
    ) external payable override returns (bytes4) {
        if (mode == Mode.Revert) revert Nope("hook says no");
        if (mode == Mode.RejectValue && msg.value != 0) revert Nope("no value please");
        _calls.push(
            Call({
                caller: msg.sender,
                sender: sender,
                author: author,
                index: index,
                prevBlock: prevBlock,
                title: title,
                payload: payload,
                hookData: hookData,
                value: msg.value,
                countSeen: glyph.count(author),
                latestSeen: glyph.latestBlock(author)
            })
        );
        if (mode == Mode.WrongSelector) return bytes4(0xdeadbeef);
        return IPublishHook.onPublish.selector;
    }
}

/// A hook that re-enters the core and publishes a post of its own.
contract ReenteringHook is IPublishHook {
    GlyphV2 public immutable glyph;

    constructor(GlyphV2 glyph_) {
        glyph = glyph_;
    }

    function onPublish(address, address, uint256, uint256, bytes32, bytes calldata, bytes calldata)
        external
        payable
        override
        returns (bytes4)
    {
        glyph.publish(bytes32("from the hook"), hex"3b");
        return IPublishHook.onPublish.selector;
    }
}

/// A hook that charges a fee in ETH and keeps it.
contract FeeHook is IPublishHook {
    error FeeNotPaid(uint256 wanted, uint256 got);

    uint256 public immutable fee;
    uint256 public received;

    constructor(uint256 fee_) {
        fee = fee_;
    }

    function onPublish(address, address, uint256, uint256, bytes32, bytes calldata, bytes calldata)
        external
        payable
        override
        returns (bytes4)
    {
        if (msg.value < fee) revert FeeNotPaid(fee, msg.value);
        received += msg.value;
        return IPublishHook.onPublish.selector;
    }
}

/// An ERC-1271 wallet owned by one key, which can be told to answer wrongly
/// or to fail outright.
contract SmartWallet {
    bytes4 internal constant MAGIC = 0x1626ba7e;

    address public immutable owner;
    bool public wrongMagic;
    bool public broken;

    constructor(address owner_) {
        owner = owner_;
    }

    function setWrongMagic(bool v) external {
        wrongMagic = v;
    }

    function setBroken(bool v) external {
        broken = v;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (broken) revert("wallet down");
        if (signature.length != 65) return bytes4(0);
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (ecrecover(hash, v, r, s) != owner) return bytes4(0);
        return wrongMagic ? bytes4(0x11111111) : MAGIC;
    }
}
