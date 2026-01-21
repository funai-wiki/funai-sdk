/**
 * ECIES Encryption utilities compatible with the Funai Signer's decryption
 * Uses AES-256-GCM for symmetric encryption
 */

import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';
import { bytesToHex, utf8ToBytes } from '@funai/common';

/**
 * EncryptedData structure matching the Signer's expected format
 */
export interface EncryptedData {
  signer_public_key: string;
  ephemeral_public_key: string;
  ciphertext: string;
  nonce: string;
  signature?: string;
}

/**
 * Encrypt data using ECIES with AES-256-GCM
 * Compatible with the Signer's decryption implementation
 * 
 * @param plaintext - The plaintext string to encrypt
 * @param recipientPublicKeyHex - The recipient's public key in hex format
 * @returns Promise resolving to the EncryptedData JSON string
 */
export async function encryptForSigner(
  plaintext: string,
  recipientPublicKeyHex: string
): Promise<string> {
  // Dynamically import secp256k1 to handle ESM/CJS compatibility
  const secp = await import('@noble/secp256k1');
  
  // Generate ephemeral key pair
  const ephemeralPrivateKey = secp.utils.randomPrivateKey();
  const ephemeralPublicKey = secp.getPublicKey(ephemeralPrivateKey, true); // compressed
  
  // Compute shared secret using ECDH
  const sharedPoint = secp.getSharedSecret(ephemeralPrivateKey, recipientPublicKeyHex, true);
  // Skip the prefix byte (0x02 or 0x03) to get the x-coordinate
  const sharedSecretX = sharedPoint.slice(1, 33);
  
  // Derive encryption key using SHA-256
  const encryptionKey = sha256(sharedSecretX);
  
  // Generate random nonce (12 bytes for AES-GCM)
  const nonce = randomBytes(12);
  
  // Encrypt using AES-256-GCM via Node.js crypto
  const plaintextBytes = utf8ToBytes(plaintext);
  
  let ciphertextBytes: Uint8Array;
  
  // Use Node.js crypto module for AES-GCM
  const crypto = await import('crypto');
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintextBytes), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // AES-GCM ciphertext format: encrypted_data + auth_tag (16 bytes)
  ciphertextBytes = new Uint8Array([...encrypted, ...authTag]);
  
  // Create EncryptedData structure
  const encryptedData: EncryptedData = {
    signer_public_key: recipientPublicKeyHex,
    ephemeral_public_key: bytesToHex(ephemeralPublicKey),
    ciphertext: bytesToHex(ciphertextBytes),
    nonce: bytesToHex(nonce),
  };
  
  return JSON.stringify(encryptedData);
}
