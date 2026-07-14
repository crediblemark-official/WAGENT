import { describe, it, expect, beforeEach } from 'vitest';
import { SafeShell } from './safe-shell.js';

describe('SafeShell', () => {
  let shell: SafeShell;

  beforeEach(() => {
    shell = new SafeShell();
  });

  describe('canExecute', () => {
    it('allows whitelisted commands', () => {
      expect(shell.canExecute('ls')).toBe(true);
      expect(shell.canExecute('cat file.txt')).toBe(true);
      expect(shell.canExecute('grep pattern file')).toBe(true);
    });

    it('blocks denied commands', () => {
      expect(shell.canExecute('rm -rf /')).toBe(false);
      expect(shell.canExecute('sudo something')).toBe(false);
      expect(shell.canExecute('bash script.sh')).toBe(false);
    });

    it('blocks non-whitelisted commands', () => {
      expect(shell.canExecute('python script.py')).toBe(false);
      expect(shell.canExecute('node app.js')).toBe(false);
    });

    it('blocks commands with directory traversal', () => {
      expect(shell.canExecute('cat ../../etc/passwd')).toBe(false);
      expect(shell.canExecute('ls /etc/')).toBe(false);
    });
  });

  describe('execute', () => {
    it('executes allowed commands', async () => {
      const result = await shell.execute('echo hello');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('hello');
    });

    it('blocks denied commands', async () => {
      const result = await shell.execute('rm -rf /');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not allowed');
    });

    it('blocks non-whitelisted commands', async () => {
      const result = await shell.execute('python3 script.py');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not in the allowed list');
    });

    it('returns empty for empty command', async () => {
      const result = await shell.execute('');
      expect(result.exitCode).toBe(1);
    });

    it('sets timedOut=false for normal commands', async () => {
      const result = await shell.execute('echo fast');
      expect(result.timedOut).toBe(false);
    });
  });

  describe('constructor with custom config', () => {
    it('allows custom allowed commands', () => {
      const custom = new SafeShell({ allowed: ['custom_cmd'] });
      expect(custom.canExecute('custom_cmd')).toBe(true);
      expect(custom.canExecute('ls')).toBe(false);
    });

    it('allows custom denied commands', () => {
      const custom = new SafeShell({ denied: ['my_dangerous_cmd'] });
      expect(custom.canExecute('my_dangerous_cmd')).toBe(false);
    });

    it('allows custom restricted directories', () => {
      const custom = new SafeShell({ restrictedDirs: ['/opt'] });
      expect(custom.canExecute('cat /opt/file.txt')).toBe(false);
      expect(custom.canExecute('ls /other/path')).toBe(true);
    });
  });

  describe('getAllowedCommands', () => {
    it('returns list of allowed commands', () => {
      const commands = shell.getAllowedCommands();
      expect(commands).toContain('ls');
      expect(commands).toContain('cat');
      expect(commands).toContain('grep');
      expect(commands).not.toContain('rm');
    });
  });
});
