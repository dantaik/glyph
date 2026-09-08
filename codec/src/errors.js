// errors.js — the ways a conversion can refuse, each with a name and a code.
//
// A pure function that cannot do what it was asked has one honest answer:
// throw, and say exactly why. Every error this package raises is a
// CodecError with a stable `code` a caller can switch on, and the subclasses
// carry what the caller needs to act — the problems a post has, the version
// a payload declares.

export class CodecError extends Error {
  /**
   * @param {string} message
   * @param {{ code: string, [key: string]: unknown }} details
   */
  constructor(message, { code, ...details } = {}) {
    super(message);
    this.name = 'CodecError';
    this.code = code ?? 'CODEC';
    Object.assign(this, details);
  }
}

/**
 * A post that cannot be written. `problems` is the full list from
 * `validatePost` — every error-level entry, not only the first, so a form can
 * mark every field at once.
 */
export class InvalidPostError extends CodecError {
  /** @param {import('./post.js').Problem[]} problems */
  constructor(problems) {
    const errors = problems.filter((p) => p.level === 'error');
    const summary = errors.map((p) => `${p.path}: ${p.message}`).join('; ');
    super(`invalid post — ${summary}`, { code: 'INVALID_POST' });
    this.name = 'InvalidPostError';
    this.problems = problems;
  }
}

/** A payload that declares a format version this library does not know. */
export class UnsupportedFormatVersionError extends CodecError {
  /**
   * @param {number} version the version the payload (or the caller) named
   * @param {readonly number[]} supported the versions this library implements
   */
  constructor(version, supported) {
    super(
      `format version ${version} is not supported by this library (supported: ${supported.join(', ')})`,
      { code: 'UNSUPPORTED_FORMAT_VERSION' },
    );
    this.name = 'UnsupportedFormatVersionError';
    this.version = version;
    this.supported = [...supported];
  }
}

/** Bytes that are not a payload of any version this library knows. */
export class MalformedPayloadError extends CodecError {
  constructor(message, details = {}) {
    super(message, { code: 'MALFORMED_PAYLOAD', ...details });
    this.name = 'MalformedPayloadError';
  }
}

/**
 * A payload that would decompress past the bound a reader allows — a
 * decompression bomb, or a document larger than any post has business
 * being — or a document a writer was asked to write past that bound.
 */
export class DocumentTooLargeError extends CodecError {
  /** @param {number} limit the bound in bytes of UTF-8 */
  constructor(limit) {
    super(`the document is larger than the ${limit}-byte bound (a decompression bomb, or raise maxDocumentBytes)`, {
      code: 'DOCUMENT_TOO_LARGE',
    });
    this.name = 'DocumentTooLargeError';
    this.limit = limit;
  }
}

/** Bytes that are not a `publish(bytes32,bytes)` call. */
export class MalformedCallDataError extends CodecError {
  constructor(message, details = {}) {
    super(message, { code: 'MALFORMED_CALLDATA', ...details });
    this.name = 'MalformedCallDataError';
  }
}
