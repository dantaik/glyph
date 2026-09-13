// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  IPublishHook — third-party code that runs inside a post.
/// @notice A hook is a contract an author names when publishing on Xueni.
///         The core records the post first — the author's head pointer is
///         moved and the `Post` event is emitted — and then calls the hook
///         once, with everything the event carries plus the payload bytes
///         and whatever the author attached for it (`hookData`). A hook that
///         reverts reverts the post; a hook that returns anything but its
///         own selector is rejected by the core.
///
///         What a hook can do is gate (revert unless a condition holds),
///         charge (it receives the call's ETH), record (its own storage and
///         events — an index, a publication, a mint), and nothing else: the
///         author of record is decided by the core before the hook runs and
///         no hook can change it.
///
///         A hook MUST accept calls only from the Xueni contract (or a
///         fan-out it explicitly trusts, see hooks/MultiHook.sol); otherwise
///         anyone could feed it publishes that never happened. See
///         hooks/BasePublishHook.sol for the boilerplate.
interface IPublishHook {
    /// @param sender    who called the core: the author, or a relayer (publishFor)
    /// @param author    the author of record, as the Post event names them
    /// @param index     the author's 0-based post number (the Post event's `index`)
    /// @param prevBlock the block of the author's previous post (the event's `prevBlock`)
    /// @param title     the bytes32 title
    /// @param payload   the payload bytes, exactly as the transaction carries them
    /// @param hookData  opaque bytes the author attached for this hook
    /// @return          `IPublishHook.onPublish.selector`, or the core rejects the hook
    function onPublish(
        address sender,
        address author,
        uint256 index,
        uint256 prevBlock,
        bytes32 title,
        bytes calldata payload,
        bytes calldata hookData
    ) external payable returns (bytes4);
}
