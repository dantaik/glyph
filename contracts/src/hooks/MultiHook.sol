// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPublishHook} from "../IPublishHook.sol";

/// @title  MultiHook — one post, several hooks.
/// @notice The core takes exactly one hook per post. To put a post through
///         several, an author names this contract as the hook and packs the
///         real ones into its data: `abi.encode(address[] hooks, bytes[]
///         datas, uint256[] values)`. Each inner hook is called in that
///         order with the very same arguments the core passed here, its own
///         data blob and its share of the ETH; the shares must add up to what
///         was sent. Any inner hook reverting reverts the post.
///
///         Inner hooks see this contract as `msg.sender`, not the core, so a
///         hook takes part only if it lists this contract as its trusted
///         `composer` (BasePublishHook). Deployed once, immutably, next to
///         the core, so that trust is the same trust as trusting the core.
contract MultiHook is IPublishHook {
    /// @dev What the core passed, carried to each inner hook unchanged.
    struct Forward {
        address sender;
        address author;
        uint256 index;
        uint256 prevBlock;
        bytes32 title;
    }

    /// @notice The GlyphV2 contract this fan-out serves.
    address public immutable glyph;

    /// @notice Which hooks a post went through, in order.
    event Composed(address indexed author, uint256 index, address[] hooks);

    error NotGlyph(address caller);
    error NoHooks();
    error LengthMismatch();
    error ValueMismatch(uint256 declared, uint256 sent);
    error NotAHook(address hook);
    error HookRejected(address hook, bytes4 returned);

    constructor(address glyph_) {
        glyph = glyph_;
    }

    /// @notice What to put in `hookData` when naming this contract as the hook.
    function encode(address[] calldata hooks, bytes[] calldata datas, uint256[] calldata values)
        external
        pure
        returns (bytes memory)
    {
        return abi.encode(hooks, datas, values);
    }

    /// @inheritdoc IPublishHook
    function onPublish(
        address sender,
        address author,
        uint256 index,
        uint256 prevBlock,
        bytes32 title,
        bytes calldata payload,
        bytes calldata hookData
    ) external payable override returns (bytes4) {
        if (msg.sender != glyph) revert NotGlyph(msg.sender);
        (address[] memory hooks, bytes[] memory datas, uint256[] memory values) =
            abi.decode(hookData, (address[], bytes[], uint256[]));
        _fanOut(Forward(sender, author, index, prevBlock, title), payload, hooks, datas, values);
        emit Composed(author, index, hooks);
        return IPublishHook.onPublish.selector;
    }

    function _fanOut(
        Forward memory f,
        bytes calldata payload,
        address[] memory hooks,
        bytes[] memory datas,
        uint256[] memory values
    ) private {
        uint256 n = hooks.length;
        if (n == 0) revert NoHooks();
        if (datas.length != n || values.length != n) revert LengthMismatch();
        uint256 total;
        for (uint256 i; i < n; ++i) total += values[i];
        if (total != msg.value) revert ValueMismatch(total, msg.value);
        for (uint256 i; i < n; ++i) _call(f, payload, hooks[i], values[i], datas[i]);
    }

    function _call(Forward memory f, bytes calldata payload, address hook, uint256 value, bytes memory data)
        private
    {
        if (hook.code.length == 0) revert NotAHook(hook);
        bytes4 answer = IPublishHook(hook).onPublish{value: value}(
            f.sender, f.author, f.index, f.prevBlock, f.title, payload, data
        );
        if (answer != IPublishHook.onPublish.selector) revert HookRejected(hook, answer);
    }
}
