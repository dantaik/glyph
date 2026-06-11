// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  Glyph — ownerless, multi-author, append-only on-chain journal.
/// @notice One immutable contract shared by any number of authors. Each
///         `msg.sender` is their own author, with an O(1) "latest" lookup
///         and a reverse-block-linked list so readers never scan ranges.
///
///         The body lives only in the `publish()` tx calldata (read back
///         via `eth_getTransactionByHash`), NOT in the event — this keeps
///         the title-list query cheap (no body bytes downloaded).
contract Glyph {
    /// @dev Per-author head pointer, packed into one storage slot.
    ///      uint96 covers ~7.9e28 block numbers; uint48 covers ~2.8e14 posts.
    struct AuthorState {
        uint96 latestBlock; // 0 = author has never posted
        uint48 count;       // total posts by this author (== next post's index)
    }

    mapping(address => AuthorState) private _authors;

    /// @param author    msg.sender (indexed → filter by author)
    /// @param index     this author's 0-based post number
    /// @param prevBlock block of this author's previous post (0 for their first)
    /// @param title     UTF-8 title, zero-padded to 32 bytes
    event Post(
        address indexed author,
        uint256 index,
        uint256 prevBlock,
        bytes32 title
    );

    function latestBlock(address author) external view returns (uint256) {
        return _authors[author].latestBlock;
    }

    function count(address author) external view returns (uint256) {
        return _authors[author].count;
    }

    /// @notice Publish one article. `payload` is brotli-compressed UTF-8 whose
    ///         schema is defined off-chain (see payload.js): a Markdown document
    ///         with optional YAML front-matter carrying tags. The contract never
    ///         reads `payload`; it just rides in the tx calldata so readers can
    ///         fetch it via getTransactionByHash.
    function publish(bytes32 title, bytes calldata payload) external {
        payload; // silence "unused parameter" warning; bytes are in tx calldata
        AuthorState memory s = _authors[msg.sender];
        emit Post(msg.sender, s.count, s.latestBlock, title);
        _authors[msg.sender] = AuthorState({
            latestBlock: uint96(block.number),
            count: s.count + 1
        });
    }
}
