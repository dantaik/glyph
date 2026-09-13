// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPublishHook} from "./IPublishHook.sol";

/// @dev ERC-1271: a contract account says whether it signed a digest.
interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

/// @title  GlyphV2 — the ownerless, multi-author, append-only journal, with
///         two doors that v1 (Blog.sol) does not have: per-post hooks, and
///         publishing on someone's behalf against their signature.
/// @notice One immutable contract shared by any number of authors. Each
///         author is their own stream — an O(1) head pointer and a reverse
///         block-linked list, exactly as in v1 — and the body still lives only
///         in the transaction's calldata, never in the event.
///
///         What is new:
///
///         * `publish(title, payload, hook, hookData)` — after the post is
///           recorded, the core calls `hook.onPublish(...)` once, forwarding
///           the call's ETH. The hook may gate, charge, index or mint; it
///           cannot change who the author is. The hook is an indexed field
///           of the `Post` event, so a reader can filter by it. The two-
///           argument `publish(title, payload)` is byte-identical to v1's
///           call and costs the same, plus one event topic.
///
///         * `publishFor(author, ..., deadline, signature)` — anyone may
///           submit a post the author signed (EIP-712). The nonce is the
///           author's next post index, so signatures land in order and the
///           author cancels an unsubmitted one by publishing anything
///           themselves. The signature covers the title, the payload bytes,
///           the hook and its data, and the deadline; the relayer chooses only
///           the block and pays. EOAs sign with ecrecover, contract accounts
///           through ERC-1271.
///
///         No owner, no upgrade, no funds: every wei that arrives is
///         forwarded to the hook the author named, and a call with ETH and no
///         hook reverts, so nothing can be stranded here.
contract GlyphV2 {
    /// @dev Per-author head pointer, packed into one storage slot (as in v1).
    struct AuthorState {
        uint96 latestBlock; // 0 = author has never posted
        uint48 count;       // total posts by this author (== next post's index)
    }

    mapping(address => AuthorState) private _authors;

    /// @param author    the author of record (msg.sender, or the signer of a relayed post)
    /// @param hook      the hook the post went through, or the zero address
    /// @param index     this author's 0-based post number
    /// @param prevBlock block of this author's previous post (0 for their first)
    /// @param title     UTF-8 title, zero-padded to 32 bytes
    event Post(
        address indexed author,
        address indexed hook,
        uint256 index,
        uint256 prevBlock,
        bytes32 title
    );

    /// @dev ETH was sent with no hook to forward it to.
    error ValueWithoutHook();
    /// @dev The named hook has no code.
    error NotAHook(address hook);
    /// @dev The hook did not return its own selector.
    error HookRejected(address hook, bytes4 returned);
    /// @dev A relayed post was submitted after its deadline.
    error SignatureExpired(uint256 deadline);
    /// @dev The signature does not belong to `author` for this exact post.
    error InvalidSignature();

    // --- EIP-712 -----------------------------------------------------------

    bytes32 public constant PUBLISH_TYPEHASH = keccak256(
        "Publish(address author,bytes32 title,bytes32 payloadHash,address hook,bytes32 hookDataHash,uint256 index,uint256 deadline)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("Glyph");
    bytes32 private constant VERSION_HASH = keccak256("2");

    /// @dev secp256k1n / 2: a signature whose `s` is above it is the malleated
    ///      twin of a valid one, and is refused (EIP-2).
    uint256 private constant HALF_ORDER = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    uint256 private immutable _cachedChainId;
    bytes32 private immutable _cachedDomainSeparator;

    constructor() {
        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _domainSeparator();
    }

    // --- Views -------------------------------------------------------------

    function latestBlock(address author) external view returns (uint256) {
        return _authors[author].latestBlock;
    }

    function count(address author) external view returns (uint256) {
        return _authors[author].count;
    }

    /// @notice The EIP-712 domain separator: name "Glyph", version "2", this
    ///         chain, this contract. Recomputed if the chain id ever changes
    ///         under the cached one (a fork), so a signature never crosses.
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == _cachedChainId ? _cachedDomainSeparator : _domainSeparator();
    }

    /// @notice ERC-5267: how to build the domain, for wallets and tools.
    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        )
    {
        return (hex"0f", "Glyph", "2", block.chainid, address(this), bytes32(0), new uint256[](0));
    }

    /// @notice The digest `author` signs for a relayed post. `index` must be
    ///         the author's post count at the time the post lands (their
    ///         next index); anything else is a signature for a different post.
    function publishDigest(
        address author,
        bytes32 title,
        bytes32 payloadHash,
        address hook,
        bytes32 hookDataHash,
        uint256 index,
        uint256 deadline
    ) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PUBLISH_TYPEHASH, author, title, payloadHash, hook, hookDataHash, index, deadline))
            )
        );
    }

    // --- Publishing --------------------------------------------------------

    /// @notice Publish one article, exactly as v1 does: the same selector,
    ///         the same calldata, no hook. `payload` rides in the calldata
    ///         only; the contract never reads it.
    function publish(bytes32 title, bytes calldata payload) external {
        _publish(msg.sender, msg.sender, _authors[msg.sender], title, payload, address(0), payload[:0]);
    }

    /// @notice Publish one article through `hook`, which is called once
    ///         after the post is recorded and receives the call's ETH along
    ///         with `hookData`. A zero `hook` is a plain post (and then no
    ///         ETH may be sent).
    function publish(bytes32 title, bytes calldata payload, address hook, bytes calldata hookData)
        external
        payable
    {
        _publish(msg.sender, msg.sender, _authors[msg.sender], title, payload, hook, hookData);
    }

    /// @notice Publish one article on `author`'s behalf. `signature` is the
    ///         author's EIP-712 signature over `publishDigest(author, title,
    ///         keccak256(payload), hook, keccak256(hookData), count(author),
    ///         deadline)`. The caller pays the gas and supplies whatever ETH
    ///         the hook wants; the post is recorded under `author`.
    function publishFor(
        address author,
        bytes32 title,
        bytes calldata payload,
        address hook,
        bytes calldata hookData,
        uint256 deadline,
        bytes calldata signature
    ) external payable {
        if (block.timestamp > deadline) revert SignatureExpired(deadline);
        AuthorState memory s = _authors[author];
        bytes32 digest = publishDigest(author, title, keccak256(payload), hook, keccak256(hookData), s.count, deadline);
        if (!_isValidSignature(author, digest, signature)) revert InvalidSignature();
        _publish(msg.sender, author, s, title, payload, hook, hookData);
    }

    /// @dev Effects first, then the event, then the hook: a hook that
    ///      re-enters publishes as itself, after this post, and sees the
    ///      author's state already advanced.
    function _publish(
        address sender,
        address author,
        AuthorState memory s,
        bytes32 title,
        bytes calldata payload,
        address hook,
        bytes calldata hookData
    ) private {
        // forge-lint: disable-next-line(unsafe-typecast)
        _authors[author] = AuthorState({latestBlock: uint96(block.number), count: s.count + 1});
        emit Post(author, hook, s.count, s.latestBlock, title);
        if (hook == address(0)) {
            if (msg.value != 0) revert ValueWithoutHook();
            return;
        }
        if (hook.code.length == 0) revert NotAHook(hook);
        bytes4 answer =
            IPublishHook(hook).onPublish{value: msg.value}(sender, author, s.count, s.latestBlock, title, payload, hookData);
        if (answer != IPublishHook.onPublish.selector) revert HookRejected(hook, answer);
    }

    // --- Signatures --------------------------------------------------------

    /// @dev An EOA signature (65 bytes, or 64 in the EIP-2098 compact form)
    ///      recovered with ecrecover; failing that, a contract account asked
    ///      through ERC-1271. An address with code may be either — an
    ///      EIP-7702 delegated wallet still signs with its key.
    function _isValidSignature(address signer, bytes32 digest, bytes calldata signature)
        private
        view
        returns (bool)
    {
        if (signature.length == 65 || signature.length == 64) {
            bytes32 r = bytes32(signature[0:32]);
            bytes32 s;
            uint8 v;
            if (signature.length == 65) {
                s = bytes32(signature[32:64]);
                v = uint8(signature[64]);
            } else {
                bytes32 vs = bytes32(signature[32:64]);
                s = vs & bytes32(type(uint256).max >> 1); // the low 255 bits
                v = uint8(uint256(vs) >> 255) + 27; // the top bit

            }
            if (uint256(s) <= HALF_ORDER && (v == 27 || v == 28)) {
                address recovered = ecrecover(digest, v, r, s);
                if (recovered != address(0) && recovered == signer) return true;
            }
        }
        if (signer.code.length == 0) return false;
        (bool ok, bytes memory answer) =
            signer.staticcall(abi.encodeCall(IERC1271.isValidSignature, (digest, signature)));
        return ok && answer.length >= 32 && abi.decode(answer, (bytes32)) == bytes32(IERC1271.isValidSignature.selector);
    }

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }
}
