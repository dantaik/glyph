// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPublishHook} from "../IPublishHook.sol";

/// @title  BasePublishHook — the boilerplate every hook needs.
/// @notice Two things a hook must get right, done once here:
///
///         * Only the core may call it. A hook keeps records — "author X put
///           post N into publication P" — and those records are only worth
///           anything if every call came from a real publish. So `onPublish`
///           accepts calls from the Xueni contract and, optionally, from one
///           fan-out contract the hook developer chose to trust (see
///           MultiHook.sol), and reverts for anyone else.
///
///         * It returns its own selector, which is how the core tells a hook
///           from a contract that merely did not revert.
///
///         ETH is refused unless the hook says it takes it (`acceptsValue`),
///         so nothing an author sends by mistake is stranded in a hook that
///         never meant to hold any.
abstract contract BasePublishHook is IPublishHook {
    /// @notice The Xueni contract this hook serves.
    address public immutable xueni;
    /// @notice A fan-out allowed to call on the core's behalf, or zero for none.
    address public immutable composer;

    error NotXueni(address caller);
    error UnexpectedValue(uint256 value);

    constructor(address xueni_, address composer_) {
        xueni = xueni_;
        composer = composer_;
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
    ) external payable virtual override returns (bytes4) {
        if (msg.sender != xueni && (composer == address(0) || msg.sender != composer)) revert NotXueni(msg.sender);
        if (msg.value != 0 && !acceptsValue()) revert UnexpectedValue(msg.value);
        _onPublish(sender, author, index, prevBlock, title, payload, hookData);
        return IPublishHook.onPublish.selector;
    }

    /// @notice Whether this hook takes ETH. False unless overridden.
    function acceptsValue() public pure virtual returns (bool) {
        return false;
    }

    /// @dev The hook's own work. Revert to reject the post.
    function _onPublish(
        address sender,
        address author,
        uint256 index,
        uint256 prevBlock,
        bytes32 title,
        bytes calldata payload,
        bytes calldata hookData
    ) internal virtual;
}
