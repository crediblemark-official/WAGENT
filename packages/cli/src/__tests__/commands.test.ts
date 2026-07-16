import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initCrypto, statusCrypto } from '../commands/crypto.js';
import { resolveModelCommand, listModels, refreshModels } from '../commands/model.js';

function captureConsole() {
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    logs.push(args.join(' '));
  });
  return { logs, spy };
}

describe('CLI crypto commands', () => {
  const OLD_KEY = process.env.OPENCE_ENCRYPTION_KEY;

  afterEach(() => {
    if (OLD_KEY === undefined) delete process.env.OPENCE_ENCRYPTION_KEY;
    else process.env.OPENCE_ENCRYPTION_KEY = OLD_KEY;
  });

  describe('initCrypto', () => {
    it('generates and prints a new key when none is set', () => {
      delete process.env.OPENCE_ENCRYPTION_KEY;
      const { logs, spy } = captureConsole();
      initCrypto();
      spy.mockRestore();

      const output = logs.join('\n');
      expect(output).toContain('Encryption Key Generated');
      // A hex key (64 chars for 32 bytes) should be shown
      expect(output).toMatch(/[0-9a-f]{64}/);
    });

    it('warns instead of regenerating when key already present', () => {
      process.env.OPENCE_ENCRYPTION_KEY = 'a'.repeat(64);
      const { logs, spy } = captureConsole();
      initCrypto();
      spy.mockRestore();

      const output = logs.join('\n');
      expect(output).toContain('sudah terdeteksi');
      expect(output).not.toMatch(/Encryption Key Generated/);
    });
  });

  describe('statusCrypto', () => {
    it('reports no key when env not set', () => {
      delete process.env.OPENCE_ENCRYPTION_KEY;
      const { logs, spy } = captureConsole();
      statusCrypto();
      spy.mockRestore();

      const output = logs.join('\n');
      expect(output).toContain('Encryption Status');
      expect(output).toContain('Tidak ada');
    });

    it('reports key installed when env set', () => {
      process.env.OPENCE_ENCRYPTION_KEY = 'b'.repeat(64);
      const { logs, spy } = captureConsole();
      statusCrypto();
      spy.mockRestore();

      const output = logs.join('\n');
      expect(output).toContain('Terpasang');
    });
  });
});

describe('CLI model commands', () => {
  it('resolveModelCommand resolves a known provider alias', async () => {
    const { logs, spy } = captureConsole();
    await resolveModelCommand('openai');
    spy.mockRestore();

    const output = logs.join('\n');
    expect(output).toContain('Provider:');
    expect(output).toContain('openai');
  }, 60000);

  it('resolveModelCommand resolves an explicit model id', async () => {
    const { logs, spy } = captureConsole();
    await resolveModelCommand('gpt-4o');
    spy.mockRestore();

    const output = logs.join('\n');
    expect(output).toContain('gpt-4o');
    expect(output).toContain('Provider:');
  }, 60000);
});
