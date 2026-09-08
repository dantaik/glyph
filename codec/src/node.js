// node.js — the same surface, with Node's brotli already bound.
//
//     import { postToCallData, callDataToPost } from 'xueni-codec/node';
//
// Everything `xueni-codec` exports, plus the four functions that need a
// codec with `node:zlib` filled in. Pass `{ brotli }` anyway to use another.

import * as core from './index.js';
import { nodeBrotli } from './brotli/node.js';

export * from './index.js';
export { createNodeBrotli, nodeBrotli } from './brotli/node.js';

const withBrotli = (options = {}) => ({ brotli: nodeBrotli, ...options });

/** @type {typeof core.encodePost} */
export const encodePost = (post, options) => core.encodePost(post, withBrotli(options));

/** @type {typeof core.postToCallData} */
export const postToCallData = (post, options) => core.postToCallData(post, withBrotli(options));

/** @type {typeof core.callDataToPost} */
export const callDataToPost = (callData, options) => core.callDataToPost(callData, withBrotli(options));

/** @type {typeof core.encodePayload} */
export const encodePayload = (text, options) => core.encodePayload(text, withBrotli(options));

/** @type {typeof core.decodePayload} */
export const decodePayload = (payload, options) => core.decodePayload(payload, withBrotli(options));
