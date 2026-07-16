import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';

vi.mock('../utils/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  }),
}));

import {
  generateEncryptionKey,
  getEncryptionKey,
  isEncryptionAvailable,
  getAESKey,
  encrypt,
  decrypt,
  encryptString,
  decryptString,
  encryptFile,
  decryptFile,
  encryptDirectory,
  decryptDirectory,
  getEncryptionStatus,
} from '../utils/crypto.js';

const TMP = join(import.meta.dirname, '_crypto_test_tmp');

function makeKey(): Buffer {
  return randomBytes(32);
}

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  delete process.env.OPENCE_ENCRYPTION_KEY;
});

describe('crypto', () => {
  describe('generateEncryptionKey', () => {
    it('generates a 64-char hex string (256-bit)', () => {
      const key = generateEncryptionKey();
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generates unique keys on each call', () => {
      const a = generateEncryptionKey();
      const b = generateEncryptionKey();
      expect(a).not.toBe(b);
    });
  });

  describe('getEncryptionKey / isEncryptionAvailable', () => {
    it('returns null when env var is not set', () => {
      delete process.env.OPENCE_ENCRYPTION_KEY;
      expect(getEncryptionKey()).toBeNull();
    });

    it('returns the env var value when set', () => {
      process.env.OPENCE_ENCRYPTION_KEY = 'test-key-123';
      expect(getEncryptionKey()).toBe('test-key-123');
    });

    it('isEncryptionAvailable returns false without key', () => {
      delete process.env.OPENCE_ENCRYPTION_KEY;
      expect(isEncryptionAvailable()).toBe(false);
    });

    it('isEncryptionAvailable returns true with key', () => {
      process.env.OPENCE_ENCRYPTION_KEY = generateEncryptionKey();
      expect(isEncryptionAvailable()).toBe(true);
    });
  });

  describe('getAESKey', () => {
    it('returns null when env var is not set', () => {
      delete process.env.OPENCE_ENCRYPTION_KEY;
      expect(getAESKey()).toBeNull();
    });

    it('returns null for a key shorter than 32 bytes', () => {
      process.env.OPENCE_ENCRYPTION_KEY = 'abcd';
      expect(getAESKey()).toBeNull();
    });

    it('returns a 32-byte buffer from a valid hex key', () => {
      const hexKey = randomBytes(32).toString('hex');
      process.env.OPENCE_ENCRYPTION_KEY = hexKey;
      const aes = getAESKey();
      expect(aes).not.toBeNull();
      expect(aes!.length).toBe(32);
      expect(aes!.toString('hex')).toBe(hexKey);
    });
  });

  describe('encrypt / decrypt (Buffer-level)', () => {
    it('roundtrips data correctly', () => {
      const key = makeKey();
      const data = Buffer.from('hello world');
      const encrypted = encrypt(data, key);
      const decrypted = decrypt(encrypted, key);
      expect(decrypted.equals(data)).toBe(true);
    });

    it('produces unique IVs on each encrypt call', () => {
      const key = makeKey();
      const data = Buffer.from('same data');
      const a = encrypt(data, key);
      const b = encrypt(data, key);
      expect(a.iv.equals(b.iv)).toBe(false);
    });
  });

  describe('encryptString / decryptString', () => {
    it('roundtrips a plaintext string', () => {
      const key = makeKey();
      const plaintext = 'Hello, 世界! 🔐';
      const ciphertext = encryptString(plaintext, key);
      const result = decryptString(ciphertext, key);
      expect(result).toBe(plaintext);
    });

    it('returns base64-encoded output', () => {
      const key = makeKey();
      const ciphertext = encryptString('test', key);
      expect(() => Buffer.from(ciphertext, 'base64')).not.toThrow();
    });

    it('decrypt fails with wrong key', () => {
      const key1 = makeKey();
      const key2 = makeKey();
      const ciphertext = encryptString('secret', key1);
      expect(() => decryptString(ciphertext, key2)).toThrow();
    });

    it('handles empty string', () => {
      const key = makeKey();
      const ciphertext = encryptString('', key);
      expect(decryptString(ciphertext, key)).toBe('');
    });

    it('handles large payload', () => {
      const key = makeKey();
      const payload = 'x'.repeat(100_000);
      const ciphertext = encryptString(payload, key);
      expect(decryptString(ciphertext, key)).toBe(payload);
    });
  });

  describe('encryptFile / decryptFile', () => {
    it('roundtrips a file and deletes original by default', () => {
      const key = makeKey();
      const filePath = join(TMP, 'test.txt');
      const content = 'file content here';
      writeFileSync(filePath, content);

      const encPath = encryptFile(filePath, key);
      expect(encPath).toBe(filePath + '.encrypted');
      expect(existsSync(encPath)).toBe(true);
      expect(existsSync(filePath)).toBe(false);

      const decPath = decryptFile(encPath, key);
      expect(decPath).toBe(filePath);
      expect(existsSync(filePath)).toBe(true);
      expect(existsSync(encPath)).toBe(false);
      expect(readFileSync(filePath, 'utf-8')).toBe(content);
    });

    it('keeps original when deleteOriginal is false', () => {
      const key = makeKey();
      const filePath = join(TMP, 'keep.txt');
      writeFileSync(filePath, 'keep me');

      encryptFile(filePath, key, false);
      expect(existsSync(filePath)).toBe(true);
    });

    it('keeps encrypted when deleteEncrypted is false', () => {
      const key = makeKey();
      const filePath = join(TMP, 'keep-enc.txt');
      writeFileSync(filePath, 'keep enc');

      const encPath = encryptFile(filePath, key);
      decryptFile(encPath, key, false);
      expect(existsSync(encPath)).toBe(true);
    });

    it('throws when source file does not exist', () => {
      const key = makeKey();
      expect(() => encryptFile(join(TMP, 'nope.txt'), key)).toThrow('File not found');
    });

    it('throws when encrypted file does not exist', () => {
      const key = makeKey();
      expect(() => decryptFile(join(TMP, 'nope.txt.encrypted'), key)).toThrow('Encrypted file not found');
    });
  });

  describe('encryptDirectory / decryptDirectory', () => {
    it('encrypts and decrypts multiple files recursively', () => {
      const key = makeKey();
      const dir = join(TMP, 'sessions');
      const sub = join(dir, 'sub');
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(dir, 'a.json'), '{"a":1}');
      writeFileSync(join(dir, 'b.bin'), 'binary');
      writeFileSync(join(sub, 'c.json'), '{"c":3}');
      writeFileSync(join(dir, 'readme.txt'), 'not encrypted');

      const encCount = encryptDirectory(dir, key);
      expect(encCount).toBe(3);
      expect(existsSync(join(dir, 'a.json.encrypted'))).toBe(true);
      expect(existsSync(join(sub, 'c.json.encrypted'))).toBe(true);
      expect(existsSync(join(dir, 'readme.txt'))).toBe(true);

      const decCount = decryptDirectory(dir, key);
      expect(decCount).toBe(3);
      expect(readFileSync(join(dir, 'a.json'), 'utf-8')).toBe('{"a":1}');
      expect(readFileSync(join(sub, 'c.json'), 'utf-8')).toBe('{"c":3}');
    });

    it('skips already encrypted files', () => {
      const key = makeKey();
      const dir = join(TMP, 'skip');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'a.json'), '{}');
      encryptDirectory(dir, key);
      const count = encryptDirectory(dir, key);
      expect(count).toBe(0);
    });

    it('returns 0 for non-existent directory', () => {
      const key = makeKey();
      expect(encryptDirectory(join(TMP, 'nope'), key)).toBe(0);
      expect(decryptDirectory(join(TMP, 'nope'), key)).toBe(0);
    });
  });

  describe('getEncryptionStatus', () => {
    it('reports correct status', () => {
      const key = makeKey();
      const envPath = join(TMP, '.env');
      const sessionDir = join(TMP, 'sessions');
      const dbPath = join(TMP, 'data.db');

      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(sessionDir, 'a.json.encrypted'), '');
      writeFileSync(join(sessionDir, 'b.json'), '');
      writeFileSync(dbPath + '.encrypted', '');

      process.env.OPENCE_ENCRYPTION_KEY = key.toString('hex');

      const status = getEncryptionStatus(envPath, sessionDir, dbPath);
      expect(status.keySet).toBe(true);
      expect(status.envEncrypted).toBe(false);
      expect(status.sessionEncrypted).toBe(1);
      expect(status.dbEncrypted).toBe(true);
    });

    it('reports false keySet when env var missing', () => {
      delete process.env.OPENCE_ENCRYPTION_KEY;
      mkdirSync(TMP, { recursive: true });
      const status = getEncryptionStatus(
        join(TMP, '.env'),
        join(TMP, 'sessions'),
        join(TMP, 'db.db'),
      );
      expect(status.keySet).toBe(false);
      expect(status.envEncrypted).toBe(false);
      expect(status.sessionEncrypted).toBe(0);
      expect(status.dbEncrypted).toBe(false);
    });
  });
});
