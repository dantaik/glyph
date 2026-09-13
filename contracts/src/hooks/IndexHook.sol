// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BasePublishHook} from "./BasePublishHook.sol";

/// @title  IndexHook — head pointers for anything, kept outside the core.
/// @notice The core keeps one reverse block-linked list per author and
///         nothing else, which is why the home feed has to scan block
///         ranges. This hook keeps the same kind of list per KEY: the global
///         key (every post that opted in), a tag, a series, a language —
///         whatever the author names. A reader then walks `latestBlock(key)`
///         down single blocks through the `Indexed` events, exactly as it
///         walks an author, and never scans a range.
///
///         `hookData` is empty for the global key alone, or
///         `abi.encode(bytes32[] keys)` for up to MAX_KEYS keys (the global
///         key included if wanted). Keys are attacker-controlled, and each
///         new one costs its poster a cold slot; that is their gas to spend.
contract IndexHook is BasePublishHook {
    struct Head {
        uint96 latestBlock; // 0 = nothing indexed under this key yet
        uint48 count;       // entries under this key (== the next entry's ordinal)
    }

    /// @notice The key every post can opt into.
    bytes32 public constant GLOBAL = bytes32(0);
    /// @notice The most keys one post may be filed under.
    uint256 public constant MAX_KEYS = 16;

    mapping(bytes32 => Head) private _heads;

    /// @param key         the list this entry is in
    /// @param author      the post's author of record
    /// @param keyIndex    the entry's 0-based ordinal within the key's list
    /// @param prevBlock   the block of the key's previous entry (0 for the first)
    /// @param authorIndex the post's index in its author's list (identifies the post with `author`)
    /// @param title       the post's title, so a keyed list needs no bodies
    event Indexed(
        bytes32 indexed key,
        address indexed author,
        uint256 keyIndex,
        uint256 prevBlock,
        uint256 authorIndex,
        bytes32 title
    );

    error TooManyKeys(uint256 given, uint256 max);

    constructor(address glyph_, address composer_) BasePublishHook(glyph_, composer_) {}

    /// @notice The block holding the key's newest entry (0 when there is none).
    function latestBlock(bytes32 key) external view returns (uint256) {
        return _heads[key].latestBlock;
    }

    /// @notice How many entries the key's list holds.
    function count(bytes32 key) external view returns (uint256) {
        return _heads[key].count;
    }

    /// @notice A key for a name — a tag, a series, a language.
    function keyOf(string calldata name) external pure returns (bytes32) {
        return keccak256(bytes(name));
    }

    function _onPublish(
        address,
        address author,
        uint256 index,
        uint256,
        bytes32 title,
        bytes calldata,
        bytes calldata hookData
    ) internal override {
        if (hookData.length == 0) {
            _file(GLOBAL, author, index, title);
            return;
        }
        bytes32[] memory keys = abi.decode(hookData, (bytes32[]));
        if (keys.length > MAX_KEYS) revert TooManyKeys(keys.length, MAX_KEYS);
        for (uint256 i; i < keys.length; ++i) _file(keys[i], author, index, title);
    }

    function _file(bytes32 key, address author, uint256 authorIndex, bytes32 title) private {
        Head memory h = _heads[key];
        // forge-lint: disable-next-line(unsafe-typecast)
        _heads[key] = Head({latestBlock: uint96(block.number), count: h.count + 1});
        emit Indexed(key, author, h.count, h.latestBlock, authorIndex, title);
    }
}
