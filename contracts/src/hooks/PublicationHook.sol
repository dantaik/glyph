// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BasePublishHook} from "./BasePublishHook.sol";

/// @title  PublicationHook — named collections with a door.
/// @notice A publication is a name, an owner, a membership list and its own
///         reverse block-linked list of posts. An author who names this hook
///         with `abi.encode(bytes32 id)` puts their post into that
///         publication — if they are its owner, a member, or the publication
///         is open — and stays the author of record in the core. A reader
///         walks the publication's list through `Published` events the way
///         it walks an author's, never scanning a range.
///
///         A reference hook: the owner is a plain address, membership is a
///         mapping, and ids are the hash of the name, first come first served.
contract PublicationHook is BasePublishHook {
    struct Publication {
        address owner;      // zero = no such publication
        bool open;          // anyone may post into it
        uint96 latestBlock; // block of its newest post (0 = none yet)
        uint48 count;       // posts in it (== the next entry's ordinal)
    }

    mapping(bytes32 => Publication) private _pubs;
    /// @notice Whether `member` may post into publication `id`.
    mapping(bytes32 => mapping(address => bool)) public isMember;

    event Created(bytes32 indexed id, address indexed owner, string name);
    event MemberSet(bytes32 indexed id, address indexed member, bool allowed);
    event OpenSet(bytes32 indexed id, bool open);
    event OwnerSet(bytes32 indexed id, address indexed owner);

    /// @param id          the publication
    /// @param author      the post's author of record
    /// @param pubIndex    the entry's 0-based ordinal within the publication
    /// @param prevBlock   the block of the publication's previous post (0 for the first)
    /// @param authorIndex the post's index in its author's list
    /// @param title       the post's title
    event Published(
        bytes32 indexed id,
        address indexed author,
        uint256 pubIndex,
        uint256 prevBlock,
        uint256 authorIndex,
        bytes32 title
    );

    error EmptyName();
    error Exists(bytes32 id);
    error NoSuchPublication(bytes32 id);
    error NotOwner(bytes32 id, address caller);
    error NotMember(bytes32 id, address author);

    constructor(address glyph_, address composer_) BasePublishHook(glyph_, composer_) {}

    /// @notice The id a name gets.
    function idOf(string calldata name) public pure returns (bytes32) {
        return keccak256(bytes(name));
    }

    /// @notice Start a publication. The caller owns it; nobody else may post
    ///         into it until they are made a member or it is opened.
    function create(string calldata name) external returns (bytes32 id) {
        if (bytes(name).length == 0) revert EmptyName();
        id = idOf(name);
        if (_pubs[id].owner != address(0)) revert Exists(id);
        _pubs[id].owner = msg.sender;
        emit Created(id, msg.sender, name);
    }

    function setMember(bytes32 id, address member, bool allowed) external {
        _onlyOwner(id);
        isMember[id][member] = allowed;
        emit MemberSet(id, member, allowed);
    }

    function setOpen(bytes32 id, bool open) external {
        _onlyOwner(id);
        _pubs[id].open = open;
        emit OpenSet(id, open);
    }

    function transfer(bytes32 id, address newOwner) external {
        _onlyOwner(id);
        _pubs[id].owner = newOwner;
        emit OwnerSet(id, newOwner);
    }

    /// @notice A publication's owner, whether it is open, and its list head.
    function publication(bytes32 id)
        external
        view
        returns (address owner, bool open, uint256 latestBlock, uint256 count)
    {
        Publication storage p = _pubs[id];
        return (p.owner, p.open, p.latestBlock, p.count);
    }

    function _onlyOwner(bytes32 id) private view {
        address owner = _pubs[id].owner;
        if (owner == address(0)) revert NoSuchPublication(id);
        if (msg.sender != owner) revert NotOwner(id, msg.sender);
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
        bytes32 id = abi.decode(hookData, (bytes32));
        Publication storage p = _pubs[id];
        if (p.owner == address(0)) revert NoSuchPublication(id);
        if (!p.open && author != p.owner && !isMember[id][author]) revert NotMember(id, author);
        uint256 ordinal = p.count;
        uint256 prev = p.latestBlock;
        // forge-lint: disable-next-line(unsafe-typecast)
        p.latestBlock = uint96(block.number);
        // forge-lint: disable-next-line(unsafe-typecast)
        p.count = uint48(ordinal + 1);
        emit Published(id, author, ordinal, prev, index, title);
    }
}
