import { describe, it, expect, beforeEach } from 'vitest';
import { ToolSandbox } from './tool-sandbox.js';

describe('ToolSandbox', () => {
  let sandbox: ToolSandbox;

  beforeEach(() => {
    sandbox = new ToolSandbox();
  });

  describe('isAllowed', () => {
    it('should allow whitelisted commands', () => {
      expect(sandbox.isAllowed('date')).toBe(true);
      expect(sandbox.isAllowed('echo')).toBe(true);
      expect(sandbox.isAllowed('ls')).toBe(true);
      expect(sandbox.isAllowed('cat')).toBe(true);
      expect(sandbox.isAllowed('grep')).toBe(true);
      expect(sandbox.isAllowed('head')).toBe(true);
      expect(sandbox.isAllowed('tail')).toBe(true);
      expect(sandbox.isAllowed('wc')).toBe(true);
      expect(sandbox.isAllowed('uname')).toBe(true);
    });

    it('should deny dangerous commands', () => {
      expect(sandbox.isAllowed('rm')).toBe(false);
      expect(sandbox.isAllowed('sudo')).toBe(false);
      expect(sandbox.isAllowed('chmod')).toBe(false);
      expect(sandbox.isAllowed('bash')).toBe(false);
      expect(sandbox.isAllowed('sh')).toBe(false);
      expect(sandbox.isAllowed('reboot')).toBe(false);
      expect(sandbox.isAllowed('kill')).toBe(false);
    });

    it('should deny commands not in whitelist', () => {
      expect(sandbox.isAllowed('docker')).toBe(false);
      expect(sandbox.isAllowed('python')).toBe(false);
      expect(sandbox.isAllowed('node')).toBe(false);
    });
  });

  describe('execute', () => {
    it('should execute allowed commands', async () => {
      const result = await sandbox.execute('echo', ['hello world']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('hello world');
      expect(result.stderr).toBe('');
    });

    it('should get current date', async () => {
      const result = await sandbox.execute('date');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBeTruthy();
    });

    it('should reject denied commands', async () => {
      const result = await sandbox.execute('rm', ['-rf', '/']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not allowed');
    });

    it('should reject unknown commands', async () => {
      const result = await sandbox.execute('unknown_cmd_xyz');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not allowed');
    });

    it('should handle empty arguments', async () => {
      const result = await sandbox.execute('echo');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('executeString', () => {
    it('should parse and execute command string', async () => {
      const result = await sandbox.executeString('echo test123');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('test123');
    });

    it('should reject dangerous commands in string', async () => {
      const result = await sandbox.executeString('rm -rf /');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('path restrictions', () => {
    it('should reject paths outside restricted directories for cat', async () => {
      const result = await sandbox.execute('cat', ['/etc/passwd']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('outside restricted directories');
    });

    it('should reject paths outside restricted directories for ls', async () => {
      const result = await sandbox.execute('ls', ['/root']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('outside restricted directories');
    });

    it('should allow restricted directories for cat', async () => {
      // Create a test file in a restricted directory first
      const result = await sandbox.execute('ls', ['./data']);
      // This should work or not depending on whether ./data exists, but should not be rejected for path
      expect(result.stderr).not.toContain('outside restricted directories');
    });
  });

  describe('config management', () => {
    it('should allow adding commands to whitelist', () => {
      expect(sandbox.isAllowed('wget')).toBe(false);
      sandbox.allowCommand('wget');
      expect(sandbox.isAllowed('wget')).toBe(true);
    });

    it('should deny a previously allowed command', () => {
      expect(sandbox.isAllowed('echo')).toBe(true);
      sandbox.denyCommand('echo');
      expect(sandbox.isAllowed('echo')).toBe(false);
    });

    it('should get current config', () => {
      const config = sandbox.getConfig();
      expect(config.allowedCommands).toContain('date');
      expect(config.deniedCommands).toContain('rm');
      expect(config.timeoutMs).toBeGreaterThan(0);
    });

    it('should update config', () => {
      sandbox.updateConfig({ timeoutMs: 5000, maxOutputLength: 500 });
      const config = sandbox.getConfig();
      expect(config.timeoutMs).toBe(5000);
      expect(config.maxOutputLength).toBe(500);
    });

    it('should list allowed and denied commands', () => {
      const allowed = sandbox.getAllowedCommands();
      expect(allowed).toContain('date');

      const denied = sandbox.getDeniedCommands();
      expect(denied).toContain('rm');
    });
  });
});
