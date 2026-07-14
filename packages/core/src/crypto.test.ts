import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdtempSync, rmdirSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Import all exported functions from crypto.ts
import {
  getEncryptionKey,
  isEncryptionAvailable,
  generateEncryptionKey,
  getAESKey,
  encrypt,
  decrypt,
  encryptString,
  decryptString,
  encryptFile,
  decryptFile,
  encryptDirectory,
  decryptDirectory,
  encryptEnvFile,
  decryptEnvFile,
  getEncryptionStatus,
} from './crypto.js';
import type { EncryptedData } from './crypto.js';

// ── Helpers ────────────────────────────────────────────────────

/** Save/restore the env var around tests */
const ENV_KEY = 'OPENCE_ENCRYPTION_KEY';
let originalEnv: string | undefined;

function setEnvKey(hex?: string) {
  if (hex) {
    process.env[ENV_KEY] = hex;
  } else {
    delete process.env[ENV_KEY];
  }
}

/** Create a temp directory and return its path + cleanup function */
function createTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'crypto-test-'));
  return {
    dir,
    cleanup: () => {
      try { rmdirSync(dir, { recursive: true }); } catch { /* ignore */ }
    },
  };
}

/** Create a temp file with content and return its path */
function createTempFile(dir: string, name: string, content: string): string {
  const fp = join(dir, name);
  writeFileSync(fp, content, 'utf-8');
  return fp;
}

// ── Tests ──────────────────────────────────────────────────────

describe('Crypto — Key Management', () => {
  beforeEach(() => {
    originalEnv = process.env[ENV_KEY];
  });

  afterEach(() => {
    setEnvKey(originalEnv);
  });

  it('should return null when env key not set', () => {
    setEnvKey(undefined);
    expect(getEncryptionKey()).toBeNull();
    expect(isEncryptionAvailable()).toBe(false);
    expect(getAESKey()).toBeNull();
  });

  it('should return the key from env var', () => {
    setEnvKey('aa'.repeat(32)); // 64 hex chars = 32 bytes
    expect(getEncryptionKey()).toBe('aa'.repeat(32));
    expect(isEncryptionAvailable()).toBe(true);
  });

  it('should generate a 64-char hex key (32 bytes)', () => {
    const key = generateEncryptionKey();
    expect(key).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(key)).toBe(true);
  });

  it('should generate unique keys on each call', () => {
    const k1 = generateEncryptionKey();
    const k2 = generateEncryptionKey();
    expect(k1).not.toBe(k2);
  });

  it('getAESKey should return a 32-byte buffer', () => {
    const hexKey = 'ab'.repeat(32);
    setEnvKey(hexKey);
    const buf = getAESKey();
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf!.length).toBe(32);
    expect(buf!.toString('hex')).toBe(hexKey);
  });

  it('getAESKey should return null for short keys', () => {
    setEnvKey('abcd'); // too short
    expect(getAESKey()).toBeNull();
  });
});

describe('Crypto — Core Encrypt/Decrypt', () => {
  let key: Buffer;

  beforeAll(() => {
    key = Buffer.from(generateEncryptionKey(), 'hex');
  });

  it('should encrypt and decrypt a buffer correctly', () => {
    const original = Buffer.from('Halo, ini data rahasia!');
    const encrypted = encrypt(original, key);

    // Encrypted data should be different from original
    expect(encrypted.encrypted).not.toEqual(original);
    expect(encrypted.iv).toHaveLength(16);
    expect(encrypted.tag).toHaveLength(16);

    const decrypted = decrypt(encrypted, key);
    expect(decrypted.toString()).toBe('Halo, ini data rahasia!');
  });

  it('should produce different ciphertext each time (random IV)', () => {
    const original = Buffer.from('same data');
    const r1 = encrypt(original, key);
    const r2 = encrypt(original, key);
    expect(r1.encrypted).not.toEqual(r2.encrypted);
    expect(r1.iv).not.toEqual(r2.iv);
  });

  it('should handle empty buffer', () => {
    const original = Buffer.alloc(0);
    const encrypted = encrypt(original, key);
    const decrypted = decrypt(encrypted, key);
    expect(decrypted.length).toBe(0);
  });

  it('should handle large data (1MB)', () => {
    const original = Buffer.alloc(1024 * 1024, 'A');
    const encrypted = encrypt(original, key);
    const decrypted = decrypt(encrypted, key);
    expect(decrypted).toEqual(original);
  });

  it('should throw on tampered ciphertext', () => {
    const original = Buffer.from('jangan diubah!');
    const encrypted = encrypt(original, key);
    // Corrupt the encrypted data
    encrypted.encrypted[5] ^= 0xff;
    expect(() => decrypt(encrypted, key)).toThrow();
  });

  it('should throw on wrong key', () => {
    const original = Buffer.from('data');
    const encrypted = encrypt(original, key);
    const wrongKey = Buffer.from(generateEncryptionKey(), 'hex');
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });
});

describe('Crypto — String Convenience', () => {
  let key: Buffer;

  beforeAll(() => {
    key = Buffer.from(generateEncryptionKey(), 'hex');
  });

  it('should encrypt and decrypt a string', () => {
    const original = 'Ini pesan rahasia 😊';
    const ciphertext = encryptString(original, key);
    // base64 encoded
    expect(typeof ciphertext).toBe('string');
    expect(ciphertext).not.toBe(original);

    const decrypted = decryptString(ciphertext, key);
    expect(decrypted).toBe(original);
  });

  it('should handle empty string', () => {
    const ciphertext = encryptString('', key);
    const decrypted = decryptString(ciphertext, key);
    expect(decrypted).toBe('');
  });

  it('should handle unicode/emoji', () => {
    const original = '🔥 🚀 你好! こんにちは!';
    const ciphertext = encryptString(original, key);
    const decrypted = decryptString(ciphertext, key);
    expect(decrypted).toBe(original);
  });

  it('should throw on invalid base64', () => {
    expect(() => decryptString('!!!invalid!!!', key)).toThrow();
  });

  it('should throw on wrong key for string', () => {
    const ciphertext = encryptString('rahasia', key);
    const wrongKey = Buffer.from(generateEncryptionKey(), 'hex');
    expect(() => decryptString(ciphertext, wrongKey)).toThrow();
  });
});

describe('Crypto — File Encrypt/Decrypt', () => {
  let key: Buffer;
  let dir: string;
  let cleanup: () => void;

  beforeAll(() => {
    key = Buffer.from(generateEncryptionKey(), 'hex');
  });

  beforeEach(() => {
    const tmp = createTempDir();
    dir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => cleanup());

  it('should encrypt and decrypt a text file', () => {
    const fp = createTempFile(dir, 'secret.txt', 'ini rahasia banget!');
    const encPath = encryptFile(fp, key, false); // don't delete original yet

    expect(existsSync(encPath)).toBe(true);
    // Original should still exist (deleteOriginal = false)
    expect(existsSync(fp)).toBe(true);

    // Encrypted file should be different from original
    const encContent = readFileSync(encPath);
    const originalContent = readFileSync(fp);
    expect(encContent).not.toEqual(originalContent);

    // Decrypt
    const decPath = decryptFile(encPath, key, false);
    expect(decPath).toBe(fp);
    const decrypted = readFileSync(decPath, 'utf-8');
    expect(decrypted).toBe('ini rahasia banget!');
  });

  it('should delete original when deleteOriginal=true', () => {
    const fp = createTempFile(dir, 'delete-me.txt', 'hapus nanti');
    encryptFile(fp, key, true);
    expect(existsSync(fp)).toBe(false);
    expect(existsSync(fp + '.encrypted')).toBe(true);
  });

  it('should delete encrypted after decrypt when deleteEncrypted=true', () => {
    const fp = createTempFile(dir, 'cleanup.txt', 'bersih bersih');
    const encPath = encryptFile(fp, key, false);
    expect(existsSync(encPath)).toBe(true);
    decryptFile(encPath, key, true);
    expect(existsSync(encPath)).toBe(false);
  });

  it('should throw on non-existent file encrypt', () => {
    expect(() => encryptFile('/nonexistent/file.txt', key)).toThrow('File not found');
  });

  it('should throw on non-existent decrypted file', () => {
    expect(() => decryptFile('/nonexistent/file.encrypted', key)).toThrow('Encrypted file not found');
  });

  it('should throw on wrong key for file', () => {
    const fp = createTempFile(dir, 'secret.txt', 'rahasia');
    const encPath = encryptFile(fp, key, false);
    const wrongKey = Buffer.from(generateEncryptionKey(), 'hex');
    expect(() => decryptFile(encPath, wrongKey)).toThrow();
  });
});

describe('Crypto — Directory Encrypt/Decrypt', () => {
  let key: Buffer;
  let rootDir: string;
  let cleanup: () => void;

  beforeAll(() => {
    key = Buffer.from(generateEncryptionKey(), 'hex');
  });

  beforeEach(() => {
    const tmp = createTempDir();
    rootDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => cleanup());

  function createSessionFiles(base: string) {
    mkdirSync(join(base, 'sessions'), { recursive: true });
    createTempFile(join(base, 'sessions'), 'creds.json', '{"key": "rahasia"}');
    createTempFile(join(base, 'sessions'), 'session.bin', 'binary-data');
    createTempFile(join(base, 'sessions'), 'data.db', '---db content---');
    // Non-target files — should be ignored
    createTempFile(join(base, 'sessions'), 'readme.txt', 'not encrypted');
    createTempFile(join(base, 'sessions'), 'config.yaml', 'key: value');
  }

  it('should encrypt all target files in a directory', () => {
    createSessionFiles(rootDir);
    const count = encryptDirectory(join(rootDir, 'sessions'), key, false);
    expect(count).toBe(3); // .json, .bin, .db

    // .txt and .yaml should remain unencrypted
    expect(existsSync(join(rootDir, 'sessions', 'readme.txt'))).toBe(true);
    expect(existsSync(join(rootDir, 'sessions', 'config.yaml'))).toBe(true);

    // Encrypted files should exist
    expect(existsSync(join(rootDir, 'sessions', 'creds.json.encrypted'))).toBe(true);
    expect(existsSync(join(rootDir, 'sessions', 'session.bin.encrypted'))).toBe(true);
    expect(existsSync(join(rootDir, 'sessions', 'data.db.encrypted'))).toBe(true);
  });

  it('should decrypt all .encrypted files in a directory', () => {
    createSessionFiles(rootDir);
    encryptDirectory(join(rootDir, 'sessions'), key, false);

    const count = decryptDirectory(join(rootDir, 'sessions'), key, false);
    expect(count).toBe(3); // 3 files decrypted

    // Original files should be restored
    const creds = readFileSync(join(rootDir, 'sessions', 'creds.json'), 'utf-8');
    expect(creds).toBe('{"key": "rahasia"}');
  });

  it('should return 0 for empty/non-existent directory', () => {
    expect(encryptDirectory('/nonexistent', key)).toBe(0);
    expect(decryptDirectory('/nonexistent', key)).toBe(0);
  });

  it('should recursively encrypt subdirectories', () => {
    createTempFile(rootDir, 'level0.bin', 'top');
    mkdirSync(join(rootDir, 'sub1'));
    createTempFile(join(rootDir, 'sub1'), 'level1.bin', 'mid');
    mkdirSync(join(rootDir, 'sub1', 'sub2'));
    createTempFile(join(rootDir, 'sub1', 'sub2'), 'level2.bin', 'deep');

    // Encrypt whole root dir recursively
    const count = encryptDirectory(rootDir, key, false);
    expect(count).toBe(3);

    // All .encrypted files should exist at each level
    expect(existsSync(join(rootDir, 'level0.bin.encrypted'))).toBe(true);
    expect(existsSync(join(rootDir, 'sub1', 'level1.bin.encrypted'))).toBe(true);
    expect(existsSync(join(rootDir, 'sub1', 'sub2', 'level2.bin.encrypted'))).toBe(true);

    // Decrypt recursively
    const decCount = decryptDirectory(rootDir, key, false);
    expect(decCount).toBe(3);

    // Contents should be restored
    expect(readFileSync(join(rootDir, 'level0.bin'), 'utf-8')).toBe('top');
    expect(readFileSync(join(rootDir, 'sub1', 'level1.bin'), 'utf-8')).toBe('mid');
    expect(readFileSync(join(rootDir, 'sub1', 'sub2', 'level2.bin'), 'utf-8')).toBe('deep');
  });
});

describe('Crypto — .env File Encryption', () => {
  let key: Buffer;
  let dir: string;
  let cleanup: () => void;

  beforeAll(() => {
    key = Buffer.from(generateEncryptionKey(), 'hex');
  });

  beforeEach(() => {
    const tmp = createTempDir();
    dir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => cleanup());

  it('should encrypt .env to .env.encrypted', () => {
    const envPath = createTempFile(dir, '.env', 'SECRET=123\nAPI_KEY=abc');
    const result = encryptEnvFile(envPath, key);
    expect(result).toBe(envPath + '.encrypted');
    // Original .env should be deleted
    expect(existsSync(envPath)).toBe(false);
    expect(existsSync(envPath + '.encrypted')).toBe(true);
  });

  it('should decrypt .env.encrypted back to .env', () => {
    const envPath = createTempFile(dir, '.env', 'DATABASE_URL=postgres://user:pass@host/db');
    encryptEnvFile(envPath, key);
    const result = decryptEnvFile(envPath, key);
    expect(result).toBe(envPath);
    expect(existsSync(envPath)).toBe(true);
    expect(existsSync(envPath + '.encrypted')).toBe(false);
    const content = readFileSync(envPath, 'utf-8');
    expect(content).toBe('DATABASE_URL=postgres://user:pass@host/db');
  });

  it('should return null if .env does not exist', () => {
    expect(encryptEnvFile('/nonexistent/.env', key)).toBeNull();
  });

  it('should return null if .env.encrypted does not exist', () => {
    expect(decryptEnvFile('/nonexistent/.env', key)).toBeNull();
  });
});

describe('Crypto — Encryption Status', () => {
  let key: Buffer;
  let dir: string;
  let cleanup: () => void;
  let originalEnvVal: string | undefined;

  beforeAll(() => {
    key = Buffer.from(generateEncryptionKey(), 'hex');
  });

  beforeEach(() => {
    originalEnvVal = process.env[ENV_KEY];
    const tmp = createTempDir();
    dir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
    setEnvKey(originalEnvVal);
  });

  it('should report correct status with key set and encrypted files', () => {
    setEnvKey(key.toString('hex'));

    // Create .env.encrypted
    createTempFile(dir, '.env.encrypted', 'encrypted-data');
    // Create session dir with some encrypted files
    mkdirSync(join(dir, 'sessions'));
    createTempFile(join(dir, 'sessions'), 'creds.json.encrypted', 'data');
    createTempFile(join(dir, 'sessions'), 'session.bin.encrypted', 'data');
    // Create encrypted db
    createTempFile(dir, 'data.db.encrypted', 'data');

    const envPath = join(dir, '.env');
    const status = getEncryptionStatus(envPath, join(dir, 'sessions'), join(dir, 'data.db'));
    expect(status.keySet).toBe(true);
    expect(status.envEncrypted).toBe(true);
    expect(status.sessionEncrypted).toBe(2);
    expect(status.dbEncrypted).toBe(true);
  });

  it('should report false/0 when nothing is encrypted', () => {
    setEnvKey(undefined);
    mkdirSync(join(dir, 'sessions'));
    createTempFile(dir, '.env', 'not encrypted');

    const envPath = join(dir, '.env');
    const status = getEncryptionStatus(envPath, join(dir, 'sessions'), join(dir, 'data.db'));
    expect(status.keySet).toBe(false);
    expect(status.envEncrypted).toBe(false);
    expect(status.sessionEncrypted).toBe(0);
    expect(status.dbEncrypted).toBe(false);
  });
});
