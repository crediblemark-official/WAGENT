import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolSandbox } from '../tools/tool-sandbox.js';
import { ToolSandboxConfig } from '../types.js';

vi.mock('../utils/logger.js', () => ({
  getLogger: () => ({
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }),
  }),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
  exec: vi.fn(),
}));

function createMocks() {
  const execFile = vi.fn();
  return { execFile };
}

describe('ToolSandbox', () => {
  let sandbox: ToolSandbox;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(async () => {
    vi.useFakeTimers();
    mocks = createMocks();
    const cp = await import('child_process');
    (cp.execFile as any) = mocks.execFile;
    sandbox = new ToolSandbox();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('applies default config', () => {
      const config = sandbox.getConfig();
      expect(config.allowedCommands).toContain('date');
      expect(config.allowedCommands).toContain('curl');
      expect(config.allowedCommands).toContain('ls');
      expect(config.deniedCommands).toContain('rm');
      expect(config.deniedCommands).toContain('sudo');
      expect(config.deniedCommands).toContain('bash');
      expect(config.timeoutMs).toBe(10_000);
      expect(config.maxOutputLength).toBe(10_000);
      expect(config.restrictedDirs).toContain('./data');
    });

    it('merges partial config with defaults', () => {
      const s = new ToolSandbox({ timeoutMs: 5_000, allowedCommands: ['custom'] });
      const config = s.getConfig();
      expect(config.timeoutMs).toBe(5_000);
      expect(config.allowedCommands).toContain('custom');
      expect(config.deniedCommands).toContain('rm');
    });

    it('returns a copy from getConfig (no leak)', () => {
      const config = sandbox.getConfig();
      config.timeoutMs = 999;
      expect(sandbox.getConfig().timeoutMs).toBe(10_000);
    });
  });

  describe('isAllowed', () => {
    it('returns true for whitelisted commands', () => {
      expect(sandbox.isAllowed('date')).toBe(true);
      expect(sandbox.isAllowed('curl')).toBe(true);
      expect(sandbox.isAllowed('jq')).toBe(true);
      expect(sandbox.isAllowed('echo')).toBe(true);
    });

    it('returns false for denied commands', () => {
      expect(sandbox.isAllowed('rm')).toBe(false);
      expect(sandbox.isAllowed('sudo')).toBe(false);
      expect(sandbox.isAllowed('bash')).toBe(false);
      expect(sandbox.isAllowed('chmod')).toBe(false);
    });

    it('returns false for unknown commands', () => {
      expect(sandbox.isAllowed('python')).toBe(false);
      expect(sandbox.isAllowed('node')).toBe(false);
      expect(sandbox.isAllowed('docker')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(sandbox.isAllowed('DATE')).toBe(true);
      expect(sandbox.isAllowed('Sudo')).toBe(false);
    });

    it('denied overrides allowed (explicit deny)', () => {
      const s = new ToolSandbox({
        allowedCommands: ['my-cmd'],
        deniedCommands: ['my-cmd'],
      });
      expect(s.isAllowed('my-cmd')).toBe(false);
    });
  });

  describe('execute', () => {
    it('runs an allowed command and returns result', async () => {
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(null, 'hello world\n', '', null);
      });

      const result = await sandbox.execute('echo', ['hello', 'world']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello world\n');
      expect(result.stderr).toBe('');
      expect(result.timedOut).toBe(false);
      expect(result.command).toBe('echo');
    });

    it('returns error for disallowed command', async () => {
      const result = await sandbox.execute('rm', ['-rf', '/']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not allowed');
      expect(result.stdout).toBe('');
      expect(result.timedOut).toBe(false);
      expect(mocks.execFile).not.toHaveBeenCalled();
    });

    it('returns error for unknown command', async () => {
      const result = await sandbox.execute('python3', ['script.py']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not allowed');
      expect(mocks.execFile).not.toHaveBeenCalled();
    });

    it('strips path prefix from command name', async () => {
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(null, 'ok\n', '', null);
      });

      const result = await sandbox.execute('/bin/echo', ['test']);
      expect(result.exitCode).toBe(0);
      expect(mocks.execFile).toHaveBeenCalledWith('/bin/echo', ['test'], expect.any(Object), expect.any(Function));
    });

    it('handles execFile returning a non-zero exit code', async () => {
      const error = Object.assign(new Error('command failed'), { code: 2, signal: null });
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(error, '', 'err output\n');
      });

      const result = await sandbox.execute('ls', []);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toBe('err output\n');
    });

    it('truncates output to maxOutputLength', async () => {
      const longOutput = 'x'.repeat(15_000);
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(null, longOutput, '', null);
      });

      const result = await sandbox.execute('echo', []);
      expect(result.stdout.length).toBe(10_000);
    });

    it('handles error.code as "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"', async () => {
      const error = Object.assign(new Error('maxbuffer'), {
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        signal: null,
      });
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(error, 'partial', '');
      });

      const result = await sandbox.execute('cat', []);
      expect(result.exitCode).toBe(1);
      expect(result.timedOut).toBe(false);
    });

    it('handles command-not-found (error with no numeric code)', async () => {
      const error = Object.assign(new Error('ENOENT'), { code: 'ENOENT', signal: null });
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(error, '', '');
      });

      const result = await sandbox.execute('echo', []);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('execute - timeout handling', () => {
    it('times out and sets timedOut=true', async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(error, '', '');
      });

      const result = await sandbox.execute('date', ['+%s']);
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBeNull();
    });

    it('times out on SIGTERM signal', async () => {
      const error = new Error('killed');
      (error as any).signal = 'SIGTERM';
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(error, '', '');
      });

      const result = await sandbox.execute('cat', ['/dev/null']);
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBeNull();
    });

    it('passes timeoutMs to execFile options', async () => {
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(null, '', '', null);
      });

      await sandbox.execute('echo', ['hi']);
      expect(mocks.execFile).toHaveBeenCalledWith(
        'echo',
        ['hi'],
        expect.objectContaining({ timeout: 10_000 }),
        expect.any(Function),
      );
    });

    it('respects custom timeout config', async () => {
      const s = new ToolSandbox({ timeoutMs: 500 });
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(null, '', '', null);
      });

      await s.execute('echo', ['hi']);
      expect(mocks.execFile).toHaveBeenCalledWith(
        'echo',
        ['hi'],
        expect.objectContaining({ timeout: 500 }),
        expect.any(Function),
      );
    });
  });

  describe('execute - error containment', () => {
    it('never throws; always returns SandboxResult', async () => {
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(new Error('unexpected'), '', '');
      });

      const result = await sandbox.execute('ls', []);
      expect(result).toHaveProperty('stdout');
      expect(result).toHaveProperty('stderr');
      expect(result).toHaveProperty('exitCode');
      expect(result).toHaveProperty('timedOut');
      expect(result).toHaveProperty('command');
    });

    it('contains maxBuffer errors', async () => {
      const error = Object.assign(new Error('maxbuffer exceeded'), {
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        signal: null,
      });
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(error, '', 'buffer exceeded');
      });

      const result = await sandbox.execute('cat', []);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('buffer exceeded');
    });
  });

  describe('execute - memory limits / maxOutputLength', () => {
    it('truncates stdout to maxOutputLength', async () => {
      const big = 'a'.repeat(20_000);
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(null, big, '', null);
      });

      const result = await sandbox.execute('echo', []);
      expect(result.stdout.length).toBe(10_000);
    });

    it('truncates stderr to maxOutputLength', async () => {
      const bigErr = 'e'.repeat(20_000);
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(null, '', bigErr, null);
      });

      const result = await sandbox.execute('echo', []);
      expect(result.stderr.length).toBe(10_000);
    });

    it('respects custom maxOutputLength', async () => {
      const s = new ToolSandbox({ maxOutputLength: 100 });
      const big = 'b'.repeat(500);
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(null, big, big, null);
      });

      const result = await s.execute('echo', []);
      expect(result.stdout.length).toBe(100);
      expect(result.stderr.length).toBe(100);
    });

    it('passes maxBuffer as 2x maxOutputLength to execFile', async () => {
      const s = new ToolSandbox({ maxOutputLength: 500 });
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(null, '', '', null);
      });

      await s.execute('echo', ['hi']);
      expect(mocks.execFile).toHaveBeenCalledWith(
        'echo',
        ['hi'],
        expect.objectContaining({ maxBuffer: 1000 }),
        expect.any(Function),
      );
    });
  });

  describe('executeString', () => {
    it('parses and executes a full command string', async () => {
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(null, 'ok', '', null);
      });

      const result = await sandbox.executeString('echo hello world');
      expect(result.exitCode).toBe(0);
      expect(mocks.execFile).toHaveBeenCalledWith('echo', ['hello', 'world'], expect.any(Object), expect.any(Function));
    });

    it('returns error for disallowed command string', async () => {
      const result = await sandbox.executeString('sudo rm -rf /');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not allowed');
      expect(mocks.execFile).not.toHaveBeenCalled();
    });

    it('handles extra whitespace', async () => {
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(null, '', '', null);
      });

      await sandbox.executeString('  ls   -la   ./data  ');
      expect(mocks.execFile).toHaveBeenCalledWith('ls', ['-la', './data'], expect.any(Object), expect.any(Function));
    });
  });

  describe('path traversal protection', () => {
    it('rejects file args outside restricted dirs for ls/cat/etc.', async () => {
      const result = await sandbox.execute('cat', ['/etc/passwd']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('outside restricted');
      expect(mocks.execFile).not.toHaveBeenCalled();
    });

    it('rejects path traversal via ../', async () => {
      const result = await sandbox.execute('cat', ['./data/../../etc/passwd']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('outside restricted');
    });

    it('allows paths inside restricted dirs', async () => {
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(null, 'file content', '', null);
      });

      const result = await sandbox.execute('cat', ['./data/test.txt']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('file content');
    });

    it('allows flags for file commands', async () => {
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(null, '', '', null);
      });

      await sandbox.execute('ls', ['-la', './data']);
      expect(mocks.execFile).toHaveBeenCalled();
    });

    it('allows /dev/null', async () => {
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(null, '', '', null);
      });

      await sandbox.execute('cat', ['/dev/null']);
      expect(mocks.execFile).toHaveBeenCalled();
    });

    it('skips path check for non-file commands', async () => {
      mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(null, 'result', '', null);
      });

      const result = await sandbox.execute('echo', ['/etc/passwd']);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('allowCommand / denyCommand', () => {
    it('allowCommand adds to whitelist', () => {
      sandbox.allowCommand('ffmpeg');
      expect(sandbox.isAllowed('ffmpeg')).toBe(true);
      expect(sandbox.getAllowedCommands()).toContain('ffmpeg');
    });

    it('allowCommand does not duplicate', () => {
      sandbox.allowCommand('echo');
      expect(sandbox.getAllowedCommands().filter(c => c === 'echo').length).toBe(1);
    });

    it('denyCommand adds to blacklist and removes from whitelist', () => {
      expect(sandbox.isAllowed('date')).toBe(true);
      sandbox.denyCommand('date');
      expect(sandbox.isAllowed('date')).toBe(false);
      expect(sandbox.getDeniedCommands()).toContain('date');
      expect(sandbox.getAllowedCommands()).not.toContain('date');
    });

    it('denyCommand removes from allowed list even if not in denied', () => {
      sandbox.denyCommand('unique-cmd');
      expect(sandbox.getDeniedCommands()).toContain('unique-cmd');
    });
  });

  describe('updateConfig', () => {
    it('merges partial config at runtime', () => {
      sandbox.updateConfig({ timeoutMs: 3_000 });
      expect(sandbox.getConfig().timeoutMs).toBe(3_000);
      expect(sandbox.getConfig().allowedCommands).toContain('echo');
    });

    it('replaces allowedCommands when provided', () => {
      sandbox.updateConfig({ allowedCommands: ['only-this'] });
      const config = sandbox.getConfig();
      expect(config.allowedCommands).toEqual(['only-this']);
      expect(config.deniedCommands).toContain('rm');
    });
  });
});
