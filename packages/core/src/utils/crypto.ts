import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getLogger } from './logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;  // 128 bits
const TAG_LENGTH = 16; // 128 bits
const ENCRYPTED_EXT = '.encrypted';

const ENV_KEY = 'OPENCE_ENCRYPTION_KEY';

// ── Key Management ─────────────────────────────────────────────

/**
 * Get the encryption key from environment variable
 */
export function getEncryptionKey(): string | null {
  return process.env[ENV_KEY] || null;
}

/**
 * Check if encryption is available (key is set)
 */
export function isEncryptionAvailable(): boolean {
  return !!getEncryptionKey();
}

/**
 * Generate a new random 256-bit encryption key as hex string
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Get a 32-byte AES key from the env var hex string.
 * The key is already 256-bit CSPRNG output — used directly as AES-256 key.
 */
export function getAESKey(): Buffer | null {
  const hex = getEncryptionKey();
  if (!hex) return null;
  const buf = Buffer.from(hex, 'hex');
  if (buf.length < 32) return null;
  return buf.subarray(0, 32);
}

// ── Core Encrypt / Decrypt (AES-256-GCM) ───────────────────────

export interface EncryptedData {
  encrypted: Buffer;
  iv: Buffer;
  tag: Buffer;
}

/**
 * Encrypt a Buffer with AES-256-GCM.
 * Key should be a 32-byte Buffer from getAESKey().
 * Each call generates a unique random IV.
 */
export function encrypt(data: Buffer, key: Buffer): EncryptedData {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key.subarray(0, 32), iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { encrypted, iv, tag };
}

/**
 * Decrypt data with AES-256-GCM.
 */
export function decrypt(encryptedData: EncryptedData, key: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key.subarray(0, 32), encryptedData.iv);
  decipher.setAuthTag(encryptedData.tag);
  return Buffer.concat([decipher.update(encryptedData.encrypted), decipher.final()]);
}

// ── String Convenience Methods ─────────────────────────────────

/**
 * Encrypt a string, returns base64-encoded combined payload: iv.tag.encrypted
 */
export function encryptString(plaintext: string, key: Buffer): string {
  const result = encrypt(Buffer.from(plaintext, 'utf-8'), key);
  const combined = Buffer.concat([result.iv, result.tag, result.encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypt a base64-encoded combined payload to string
 */
export function decryptString(ciphertext: string, key: Buffer): string {
  const combined = Buffer.from(ciphertext, 'base64');
  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);
  return decrypt({ encrypted, iv, tag }, key).toString('utf-8');
}

// ── File-level Encrypt / Decrypt ───────────────────────────────

/**
 * Encrypt a file, writing <path>.encrypted. Original file is optionally deleted.
 * Format: [iv(16)][tag(16)][encrypted data]
 */
export function encryptFile(filePath: string, key: Buffer, deleteOriginal = true): string {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const data = readFileSync(filePath);
  const result = encrypt(data, key);

  // Format: [iv(16)][tag(16)][encrypted data]
  const outPath = filePath + ENCRYPTED_EXT;
  writeFileSync(outPath, Buffer.concat([result.iv, result.tag, result.encrypted]));

  if (deleteOriginal) {
    unlinkSync(filePath);
  }

  getLogger().debug('Encrypted: %s → %s', filePath, outPath);
  return outPath;
}

/**
 * Decrypt a .encrypted file back to the original path.
 */
export function decryptFile(encPath: string, key: Buffer, deleteEncrypted = true): string {
  if (!existsSync(encPath)) {
    throw new Error(`Encrypted file not found: ${encPath}`);
  }

  const combined = readFileSync(encPath);
  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);

  const decrypted = decrypt({ encrypted, iv, tag }, key);
  const outPath = encPath.replace(ENCRYPTED_EXT, '');
  writeFileSync(outPath, decrypted);

  if (deleteEncrypted) {
    unlinkSync(encPath);
  }

  getLogger().debug('Decrypted: %s → %s', encPath, outPath);
  return outPath;
}

// ── Directory-level Encryption ─────────────────────────────────

/**
 * Encrypt all sensitive files in a directory (recursive)
 */
export function encryptDirectory(
  dirPath: string,
  key: Buffer,
  deleteOriginal = true,
  extensions?: string[]
): number {
  if (!existsSync(dirPath)) return 0;

  let count = 0;
  const entries = readdirSync(dirPath);

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      count += encryptDirectory(fullPath, key, deleteOriginal, extensions);
    } else if (stat.isFile()) {
      // Skip already encrypted files and non-matching extensions
      if (entry.endsWith(ENCRYPTED_EXT)) continue;
      if (extensions && !extensions.some(ext => entry.endsWith(ext))) continue;

      // Files we want to encrypt in sessions: json, bin, db
      if (entry.endsWith('.json') || entry.endsWith('.bin') || entry.endsWith('.db')) {
        encryptFile(fullPath, key, deleteOriginal);
        count++;
      }
    }
  }

  return count;
}

/**
 * Decrypt all .encrypted files in a directory (recursive)
 */
export function decryptDirectory(dirPath: string, key: Buffer, deleteEncrypted = true): number {
  if (!existsSync(dirPath)) return 0;

  let count = 0;
  const entries = readdirSync(dirPath);

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      count += decryptDirectory(fullPath, key, deleteEncrypted);
    } else if (stat.isFile() && entry.endsWith(ENCRYPTED_EXT)) {
      decryptFile(fullPath, key, deleteEncrypted);
      count++;
    }
  }

  return count;
}

// ── .env Encryption ────────────────────────────────────────────

/**
 * Encrypt the .env file to .env.encrypted, delete original .env
 */
export function encryptEnvFile(envPath: string, key: Buffer): string | null {
  if (!existsSync(envPath)) return null;
  return encryptFile(envPath, key, true);
}

/**
 * Decrypt .env.encrypted back to .env
 */
export function decryptEnvFile(envPath: string, key: Buffer): string | null {
  const encPath = envPath + ENCRYPTED_EXT;
  if (!existsSync(encPath)) return null;
  return decryptFile(encPath, key, true);
}

// ── Status ─────────────────────────────────────────────────────

export interface EncryptionStatus {
  keySet: boolean;
  envEncrypted: boolean;
  sessionEncrypted: number;
  dbEncrypted: boolean;
}

/**
 * Check encryption status of all data
 */
export function getEncryptionStatus(
  envPath: string,
  sessionDir: string,
  dbPath: string
): EncryptionStatus {
  return {
    keySet: isEncryptionAvailable(),
    envEncrypted: existsSync(envPath + ENCRYPTED_EXT),
    sessionEncrypted: existsSync(sessionDir)
      ? readdirSync(sessionDir).filter(f => f.endsWith(ENCRYPTED_EXT)).length
      : 0,
    dbEncrypted: existsSync(dbPath + ENCRYPTED_EXT),
  };
}
