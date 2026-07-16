import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const { mockExec, execRef } = vi.hoisted(() => ({
  mockExec: vi.fn(),
  execRef: { current: null as any },
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  execRef.current = actual.exec;

  const kCustomPromisified = Symbol.for('nodejs.util.promisify.custom');
  (mockExec as any)[kCustomPromisified] = function (cmd: string, opts: any) {
    return new Promise((resolve, reject) => {
      mockExec(cmd, opts, (err: any, stdout: string, stderr: string) => {
        if (err) {
          if (err.stdout == null) err.stdout = stdout;
          if (err.stderr == null) err.stderr = stderr;
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  };

  return { exec: mockExec };
});

describe('SafeShell', () => {
  let shell: any;

  beforeEach(async () => {
    const { SafeShell } = await import('../tools/safe-shell.js');
    mockExec.mockImplementation((cmd: string, opts: any, cb: Function) => {
      execRef.current(cmd, opts, cb);
    });
    shell = new SafeShell();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const allowed = shell.getAllowedCommands();
      expect(allowed).toContain('ls');
      expect(allowed).toContain('cat');
      expect(allowed).toContain('echo');
      expect(allowed).toContain('pwd');
      expect(allowed).toContain('grep');
      expect(allowed).toContain('head');
      expect(allowed).toContain('tail');
      expect(allowed).toContain('wc');
      expect(allowed).toContain('jq');
      expect(allowed).toContain('date');
    });

    it('should have default denied commands', async () => {
      const result = await shell.execute('rm file.txt');
      expect(result.stderr).toContain('not allowed');
    });

    it('should merge custom config with defaults', async () => {
      const { SafeShell } = await import('../tools/safe-shell.js');
      const custom = new SafeShell({
        allowed: ['ls', 'custom-cmd'],
        timeoutMs: 5000,
      });
      const allowed = custom.getAllowedCommands();
      expect(allowed).toContain('ls');
      expect(allowed).toContain('custom-cmd');
      expect(allowed).not.toContain('cat');
    });

    it('should override allowed list entirely when custom allowed provided', async () => {
      const { SafeShell } = await import('../tools/safe-shell.js');
      const custom = new SafeShell({ allowed: ['only-this'] });
      expect(custom.getAllowedCommands()).toEqual(['only-this']);
      expect(custom.getAllowedCommands()).not.toContain('echo');
    });
  });

  describe('canExecute', () => {
    it('should return true for whitelisted commands', () => {
      expect(shell.canExecute('ls')).toBe(true);
      expect(shell.canExecute('cat file.txt')).toBe(true);
      expect(shell.canExecute('echo hello')).toBe(true);
      expect(shell.canExecute('pwd')).toBe(true);
      expect(shell.canExecute('date')).toBe(true);
      expect(shell.canExecute('grep pattern file')).toBe(true);
      expect(shell.canExecute('head file')).toBe(true);
      expect(shell.canExecute('tail file')).toBe(true);
      expect(shell.canExecute('wc -l file')).toBe(true);
    });

    it('should return false for denied commands', () => {
      expect(shell.canExecute('rm file.txt')).toBe(false);
      expect(shell.canExecute('sudo something')).toBe(false);
      expect(shell.canExecute('chmod 777 file')).toBe(false);
      expect(shell.canExecute('chown user file')).toBe(false);
      expect(shell.canExecute('dd if=/dev/zero')).toBe(false);
      expect(shell.canExecute('mkfs.ext4 /dev/sda')).toBe(false);
      expect(shell.canExecute('fork')).toBe(false);
      expect(shell.canExecute('eval "code"')).toBe(false);
      expect(shell.canExecute('exec rm -rf /')).toBe(false);
      expect(shell.canExecute('bash script.sh')).toBe(false);
      expect(shell.canExecute('sh script.sh')).toBe(false);
      expect(shell.canExecute('zsh script.sh')).toBe(false);
    });

    it('should return false for non-whitelisted commands', () => {
      expect(shell.canExecute('docker ps')).toBe(false);
      expect(shell.canExecute('git status')).toBe(false);
      expect(shell.canExecute('npm install')).toBe(false);
      expect(shell.canExecute('python script.py')).toBe(false);
      expect(shell.canExecute('node server.js')).toBe(false);
      expect(shell.canExecute('curl http://example.com')).toBe(false);
    });

    it('should return false for empty command', () => {
      expect(shell.canExecute('')).toBe(false);
    });

    it('should return false for commands with directory traversal', () => {
      expect(shell.canExecute('ls ../../../etc/passwd')).toBe(false);
      expect(shell.canExecute('cat ../../etc/shadow')).toBe(false);
    });

    it('should return false for commands accessing restricted system paths', () => {
      expect(shell.canExecute('cat /etc/passwd')).toBe(false);
      expect(shell.canExecute('ls /var/log')).toBe(false);
      expect(shell.canExecute('cat /usr/bin/ls')).toBe(false);
      expect(shell.canExecute('ls /root/')).toBe(false);
      expect(shell.canExecute('ls /home/user')).toBe(false);
    });

    it('should return false for commands referencing custom restricted dirs', () => {
      expect(shell.canExecute('cat ./data/secret.txt')).toBe(false);
      expect(shell.canExecute('ls ./uploads/file.txt')).toBe(false);
    });
  });

  describe('getAllowedCommands', () => {
    it('should return a copy of the allowed commands array', () => {
      const cmds = shell.getAllowedCommands();
      cmds.push('hacker');
      expect(shell.getAllowedCommands()).not.toContain('hacker');
    });

    it('should contain exactly the default allowed commands', () => {
      const allowed = shell.getAllowedCommands();
      expect(allowed).toHaveLength(10);
      expect(allowed).toEqual(
        expect.arrayContaining(['date', 'echo', 'pwd', 'ls', 'cat', 'grep', 'head', 'tail', 'wc', 'jq']),
      );
    });
  });

  describe('execute - command validation', () => {
    it('should return error for empty command', async () => {
      const result = await shell.execute('');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('Empty command');
      expect(result.stdout).toBe('');
      expect(result.timedOut).toBe(false);
    });

    it('should reject denied commands with security message', async () => {
      const result = await shell.execute('rm -rf /');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not allowed for security reasons');
      expect(result.stderr).toContain('rm');
      expect(result.stdout).toBe('');
      expect(result.timedOut).toBe(false);
    });

    it('should reject non-whitelisted commands', async () => {
      const result = await shell.execute('docker ps');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not in the allowed list');
      expect(result.stderr).toContain('docker');
      expect(result.stdout).toBe('');
      expect(result.timedOut).toBe(false);
    });

    it('should reject commands with directory traversal', async () => {
      const result = await shell.execute('ls ../../../etc/passwd');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Directory access restricted');
      expect(result.timedOut).toBe(false);
    });

    it('should reject commands accessing /etc/', async () => {
      const result = await shell.execute('cat /etc/passwd');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Directory access restricted');
    });

    it('should reject commands accessing /var/', async () => {
      const result = await shell.execute('cat /var/log/syslog');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Directory access restricted');
    });

    it('should reject commands accessing /usr/', async () => {
      const result = await shell.execute('ls /usr/bin');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Directory access restricted');
    });

    it('should reject commands accessing /root/', async () => {
      const result = await shell.execute('ls /root/');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Directory access restricted');
    });

    it('should reject commands accessing /home/', async () => {
      const result = await shell.execute('cat /home/user/.ssh/id_rsa');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Directory access restricted');
    });
  });

  describe('execute - case insensitivity', () => {
    it('should match allowed commands case-insensitively', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        cb(null, 'hello\n', '');
      });
      const result = await shell.execute('ECHO hello');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
    });

    it('should match denied commands case-insensitively', async () => {
      const result = await shell.execute('RM file.txt');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not allowed for security reasons');
    });

    it('should handle mixed case allowed commands', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        cb(null, '/workspace\n', '');
      });
      const result = await shell.execute('Pwd');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBeTruthy();
    });
  });

  describe('execute - directory restriction', () => {
    it('should block relative parent traversal', async () => {
      const result = await shell.execute('cat ../secret.txt');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Directory access restricted');
    });

    it('should block absolute path to /etc', async () => {
      const result = await shell.execute('ls /etc/');
      expect(result.exitCode).toBe(1);
    });

    it('should block custom restricted dir ./data', async () => {
      const result = await shell.execute('cat ./data/secret.txt');
      expect(result.exitCode).toBe(1);
    });

    it('should block custom restricted dir ./memory', async () => {
      const result = await shell.execute('ls ./memory');
      expect(result.exitCode).toBe(1);
    });

    it('should block custom restricted dir ./uploads', async () => {
      const result = await shell.execute('cat ./uploads/file.txt');
      expect(result.exitCode).toBe(1);
    });

    it('should block custom restricted dir ./knowledge', async () => {
      const result = await shell.execute('ls ./knowledge');
      expect(result.exitCode).toBe(1);
    });

    it('should allow commands without restricted path references', async () => {
      const result = await shell.execute('echo hello');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('execute - timeout handling', () => {
    it('should set timedOut to true when process is killed', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        const err = new Error('kill') as any;
        err.killed = true;
        err.signal = 'SIGTERM';
        err.stdout = 'partial output';
        err.stderr = '';
        err.code = 124;
        cb(err);
      });

      const result = await shell.execute('echo hello');
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(124);
      expect(result.stdout).toBe('partial output');
    });

    it('should set timedOut to true when signal is SIGTERM', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        const err = new Error('timeout') as any;
        err.killed = false;
        err.signal = 'SIGTERM';
        err.stdout = '';
        err.stderr = 'command timed out';
        err.code = 124;
        cb(err);
      });

      const result = await shell.execute('echo hello');
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(124);
    });

    it('should set timedOut to false for non-timeout errors', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        const err = new Error('command failed') as any;
        err.killed = false;
        err.signal = undefined;
        err.stdout = '';
        err.stderr = 'some error';
        err.code = 2;
        cb(err);
      });

      const result = await shell.execute('echo hello');
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(2);
    });

    it('should use custom timeoutMs from config', async () => {
      const { SafeShell } = await import('../tools/safe-shell.js');
      const customShell = new SafeShell({ timeoutMs: 5000 });
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        cb(null, 'ok\n', '');
      });

      await customShell.execute('echo test');

      expect(mockExec).toHaveBeenCalledWith(
        'echo test',
        expect.objectContaining({ timeout: 5000 }),
        expect.any(Function),
      );
    });

    it('should use default timeout when not configured', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        cb(null, 'ok\n', '');
      });

      await shell.execute('echo test');

      expect(mockExec).toHaveBeenCalledWith(
        'echo test',
        expect.objectContaining({ timeout: 30000 }),
        expect.any(Function),
      );
    });

    it('should fallback to error message when stderr is empty on timeout', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        const err = new Error('timeout') as any;
        err.killed = true;
        err.signal = 'SIGTERM';
        err.stdout = '';
        err.stderr = '';
        err.code = 124;
        cb(err);
      });

      const result = await shell.execute('echo hello');
      expect(result.timedOut).toBe(true);
      expect(result.stderr).toBe('timeout');
    });

    it('should limit stdout to 10000 chars on error', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        const err = new Error('fail') as any;
        err.killed = false;
        err.signal = undefined;
        err.stdout = 'x'.repeat(15000);
        err.stderr = '';
        err.code = 1;
        cb(err);
      });

      const result = await shell.execute('echo hello');
      expect(result.stdout.length).toBeLessThanOrEqual(10000);
    });

    it('should limit stderr to 5000 chars on error', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        const err = new Error('fail') as any;
        err.killed = false;
        err.signal = undefined;
        err.stdout = '';
        err.stderr = 'y'.repeat(8000);
        err.code = 1;
        cb(err);
      });

      const result = await shell.execute('echo hello');
      expect(result.stderr.length).toBeLessThanOrEqual(5000);
    });
  });

  describe('execute - successful execution', () => {
    it('should execute echo command', async () => {
      const result = await shell.execute('echo hello');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
      expect(result.timedOut).toBe(false);
    });

    it('should execute pwd command', async () => {
      const result = await shell.execute('pwd');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBeTruthy();
    });

    it('should execute date command', async () => {
      const result = await shell.execute('date');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBeTruthy();
    });

    it('should execute ls command', async () => {
      const result = await shell.execute('ls /tmp');
      expect(result.exitCode).toBe(0);
    });

    it('should execute with custom workDir', async () => {
      const result = await shell.execute('pwd', '/tmp');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('/tmp');
    });

    it('should limit stdout to 10000 characters on success', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        cb(null, 'a'.repeat(15000), '');
      });
      const result = await shell.execute('echo test');
      expect(result.stdout.length).toBeLessThanOrEqual(10000);
    });

    it('should limit stderr to 5000 characters on success', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        cb(null, '', 'b'.repeat(8000));
      });
      const result = await shell.execute('echo test');
      expect(result.stderr.length).toBeLessThanOrEqual(5000);
    });

    it('should pass correct cwd to exec', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        cb(null, 'ok\n', '');
      });
      await shell.execute('echo test', '/var/tmp');
      expect(mockExec).toHaveBeenCalledWith(
        'echo test',
        expect.objectContaining({ cwd: '/var/tmp' }),
        expect.any(Function),
      );
    });

    it('should pass maxBuffer of 1MB to exec', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        cb(null, 'ok\n', '');
      });
      await shell.execute('echo test');
      expect(mockExec).toHaveBeenCalledWith(
        'echo test',
        expect.objectContaining({ maxBuffer: 1024 * 1024 }),
        expect.any(Function),
      );
    });
  });

  describe('execute - input sanitization', () => {
    it('should remove null bytes from command', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        cb(null, 'helloworld\n', '');
      });
      const result = await shell.execute('echo hello\0world');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('helloworld');
    });

    it('should handle command with only null bytes after stripping', async () => {
      const result = await shell.execute('\0\0\0');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('is not in the allowed list');
    });
  });

  describe('parseCommand (via execute)', () => {
    it('should handle double-quoted arguments', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        cb(null, 'hello world\n', '');
      });
      const result = await shell.execute('echo "hello world"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello world');
    });

    it('should handle single-quoted arguments', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        cb(null, 'hello world\n', '');
      });
      const result = await shell.execute("echo 'hello world'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello world');
    });

    it('should handle multiple spaces between arguments', async () => {
      const result = await shell.execute('echo    hello');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
    });

    it('should handle leading and trailing whitespace', async () => {
      const result = await shell.execute('  echo hello  ');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
    });

    it('should split command correctly to extract base command', async () => {
      const result = await shell.execute('cat -n /dev/null');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('execute - comprehensive denied commands', () => {
    const deniedCommands = [
      { cmd: 'rm file', name: 'rm' },
      { cmd: 'sudo something', name: 'sudo' },
      { cmd: 'chmod 777 file', name: 'chmod' },
      { cmd: 'chown user file', name: 'chown' },
      { cmd: 'dd if=/dev/zero of=/dev/sda', name: 'dd' },
      { cmd: 'mkfs.ext4 /dev/sda', name: 'mkfs' },
      { cmd: 'fork', name: 'fork' },
      { cmd: 'eval "dangerous"', name: 'eval' },
      { cmd: 'exec rm -rf /', name: 'exec' },
      { cmd: 'bash script.sh', name: 'bash' },
      { cmd: 'sh script.sh', name: 'sh' },
      { cmd: 'zsh script.sh', name: 'zsh' },
    ];

    deniedCommands.forEach(({ cmd, name }) => {
      it(`should deny "${name}" command: ${cmd}`, async () => {
        const result = await shell.execute(cmd);
        expect(result.exitCode).toBe(1);
        if (name === 'mkfs') {
          expect(result.stderr).toContain('not in the allowed list');
        } else {
          expect(result.stderr).toContain('not allowed for security reasons');
          expect(result.stderr).toContain(name);
        }
        expect(result.timedOut).toBe(false);
      });
    });
  });

  describe('execute - comprehensive allowed commands', () => {
    it('echo returns correct output', async () => {
      const result = await shell.execute('echo "test-value-123"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('test-value-123');
    });

    it('pwd returns a non-empty path', async () => {
      const result = await shell.execute('pwd');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim().length).toBeGreaterThan(0);
    });

    it('wc counts lines', async () => {
      const result = await shell.execute('echo -e "a\nb\nc" | wc -l');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('3');
    });

    it('ls lists directory contents', async () => {
      const result = await shell.execute('ls /tmp');
      expect(result.exitCode).toBe(0);
    });

    it('head reads first line', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        cb(null, 'line1\n', '');
      });
      const result = await shell.execute('head -1 /tmp/test.txt');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('line1');
    });

    it('tail reads last line', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        cb(null, 'line3\n', '');
      });
      const result = await shell.execute('tail -1 /tmp/test.txt');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('line3');
    });

    it('grep finds matching lines', async () => {
      mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
        cb(null, 'bar\n', '');
      });
      const result = await shell.execute('grep bar /tmp/test.txt');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('bar');
    });

    it('date returns a non-empty string', async () => {
      const result = await shell.execute('date +%Y');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d{4}$/);
    });
  });
});
