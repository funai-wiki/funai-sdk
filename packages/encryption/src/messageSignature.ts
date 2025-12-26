import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, utf8ToBytes } from '@stacks/common';
import { decode, encode, encodingLength } from './varuint';

// 'Funai Signed Message:\n'.length === 22
// 'Funai Signed Message:\n'.length.toString(16) === 16
const chainPrefix = '\x16Funai Signed Message:\n';

export function hashMessage(message: string, prefix: string = chainPrefix): Uint8Array {
  return sha256(encodeMessage(message, prefix));
}

export function encodeMessage(
  /** UTF-8 string or Uint8Array (bytes) */
  message: string | Uint8Array,
  prefix: string = chainPrefix
): Uint8Array {
  const messageBytes = typeof message == 'string' ? utf8ToBytes(message) : message;
  const encodedLength = encode(messageBytes.length);
  return concatBytes(utf8ToBytes(prefix), encodedLength, messageBytes);
}

export function decodeMessage(
  encodedMessage: Uint8Array,
  prefix: string = chainPrefix
): Uint8Array {
  // Remove the chain prefix
  const prefixByteLength = utf8ToBytes(prefix).byteLength;
  const messageWithoutChainPrefix = encodedMessage.subarray(prefixByteLength);
  const decoded = decode(messageWithoutChainPrefix);
  const varIntLength = encodingLength(decoded);
  // Remove the varint prefix
  return messageWithoutChainPrefix.slice(varIntLength);
}
