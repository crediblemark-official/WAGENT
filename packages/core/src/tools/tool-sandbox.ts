import { Logger } from 'pino';
import { execFile, exec } from 'child_process';
import { existsSync, accessSync, constants } from 'fs';
import { resolve, normalize } from 'path';
import { ToolSandboxConfig, SandboxResult } from '../types.js';
import { getLogger } from '../utils/logger.js';

/**
 * Default sandbox configuration with secure defaults.
 */
const DEFAULT_CONFIG: ToolSandboxConfig = {
  allowedCommands: ['date', 'curl', 'jq', 'ls', 'cat', 'grep', 'head', 'tail', 'wc', 'echo', 'uname'],
  deniedCommands: ['rm', 'sudo', 'chmod', 'chown', 'bash', 'sh', 'kill', 'pkill', 'reboot', 'shutdown',
    'mkfs', 'dd', 'fdisk', 'passwd', 'useradd', 'usermod', 'groupadd', 'mount', 'umount'],
  restrictedDirs: ['./data', './memory', './uploads'],
  timeoutMs: 10_000,
  maxOutputLength: 10_000,
};

/**
 * ToolSandbox provides a whitelist-based shell execution environment.
 * Only allows specific commands with restricted directories and timeout.
 */
export class ToolSandbox {
  private logger: Logger;
  private config: ToolSandboxConfig;

  constructor(config?: Partial<ToolSandboxConfig>) {
    this.logger = getLogger().child({ module: 'tool-sandbox' });
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a command in the sandbox.
   *
   * Safety measures:
   * 1. Command must be in allowedCommands whitelist
   * 2. Command must NOT be in deniedCommands blacklist
   * 3. File operations restricted to restrictedDirs
   * 4. Process killed after timeoutMs
   * 5. Output capped at maxOutputLength
   * 6. No shell interpretation (uses execFile with args)
   */
  async execute(command: string, args: string[] = []): Promise<SandboxResult> {
    // Validate command
    const cmdName = command.split('/').pop() || command;
    if (!this.isAllowed(cmdName)) {
      return {
        stdout: '',
        stderr: `Error: Command "${cmdName}" is not allowed in sandbox`,
        exitCode: 1,
        timedOut: false,
        command,
      };
    }

    // Validate arguments for path traversal
    const sanitizedArgs = this.sanitizeArgs(cmdName, args);
    if (sanitizedArgs === null) {
      return {
        stdout: '',
        stderr: 'Error: Arguments reference paths outside restricted directories',
        exitCode: 1,
        timedOut: false,
        command,
      };
    }

    // Execute with timeout
    return this.runCommand(command, sanitizedArgs);
  }

  /**
   * Convenience method: parse a full command string and execute in sandbox.
   * Simple parser that splits on spaces (doesn't handle quotes).
   * For complex commands, use execute() directly.
   */
  async executeString(fullCommand: string): Promise<SandboxResult> {
    const parts = fullCommand.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);
    return this.execute(cmd, args);
  }

  /**
   * Check if a command is allowed by the sandbox policy.
   */
  isAllowed(command: string): boolean {
    const cmd = command.toLowerCase().trim();

    // Check denied list first (explicit deny overrides allow)
    if (this.config.deniedCommands.includes(cmd)) return false;

    // Check allowed list
    if (this.config.allowedCommands.includes(cmd)) return true;

    return false;
  }

  /**
   * Validate and sanitize arguments for path traversal protection.
   * Returns sanitized args or null if rejected.
   */
  private sanitizeArgs(command: string, args: string[]): string[] | null {
    // Commands that take file paths as arguments
    const fileCommands = ['ls', 'cat', 'grep', 'head', 'tail', 'wc'];

    if (!fileCommands.includes(command)) return args;

    const sanitized: string[] = [];
    for (const arg of args) {
      // Skip flags
      if (arg.startsWith('-')) {
        sanitized.push(arg);
        continue;
      }

      // Resolve and normalize path
      const resolved = resolve(normalize(arg));

      // Check if path is within restricted directories
      const isSafe = this.config.restrictedDirs.some(dir => {
        // Handle both absolute and relative dirs
        const absDir = resolve(dir);
        return resolved.startsWith(absDir);
      });

      // Also allow /dev/null (common for output suppression)
      const isDevNull = resolved === '/dev/null';

      if (!isSafe && !isDevNull) {
        this.logger.warn({ arg, resolved }, 'Path rejected by sandbox: outside restricted directories');
        return null;
      }

      sanitized.push(arg);
    }

    return sanitized;
  }

  /**
   * Run the command with timeout.
   */
  private runCommand(command: string, args: string[]): Promise<SandboxResult> {
    return new Promise((resolve) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      // Use execFile for safety (no shell interpretation)
      execFile(command, args, {
        signal: controller.signal,
        maxBuffer: this.config.maxOutputLength * 2,
        timeout: this.config.timeoutMs,
      }, (error, stdout, stderr) => {
        clearTimeout(timeout);

        // Determine exit code:
        // - null = killed by signal (timed out)
        // - number = actual exit code from process
        // - 1 = general error (maxbuffer, not found, etc.)
        let exitCode: number | null = 0;
        let timedOut = false;

        if (error) {
          if (error.name === 'AbortError' || (error as any).signal === 'SIGTERM') {
            // Timed out
            exitCode = null;
            timedOut = true;
          } else if ((error as any).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            exitCode = 1;
          } else if (typeof (error as any).code === 'number') {
            // Actual process exit code
            exitCode = (error as any).code as number;
          } else {
            // Command not found, permission denied, etc.
            exitCode = 1;
          }
        }

        resolve({
          stdout: stdout.substring(0, this.config.maxOutputLength),
          stderr: stderr.substring(0, this.config.maxOutputLength),
          exitCode,
          timedOut,
          command,
        });
      });
    });
  }

  /**
   * Get the current sandbox configuration.
   */
  getConfig(): ToolSandboxConfig {
    return { ...this.config };
  }

  /**
   * Update sandbox configuration at runtime.
   */
  updateConfig(config: Partial<ToolSandboxConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('Sandbox config updated');
  }

  /**
   * Get list of allowed commands.
   */
  getAllowedCommands(): string[] {
    return [...this.config.allowedCommands];
  }

  /**
   * Get list of denied commands.
   */
  getDeniedCommands(): string[] {
    return [...this.config.deniedCommands];
  }

  /**
   * Add a command to the allowed list.
   */
  allowCommand(command: string): void {
    if (!this.config.allowedCommands.includes(command)) {
      this.config.allowedCommands.push(command);
      this.logger.info('Command added to sandbox whitelist: %s', command);
    }
  }

  /**
   * Remove a command from the allowed list.
   */
  denyCommand(command: string): void {
    if (!this.config.deniedCommands.includes(command)) {
      this.config.deniedCommands.push(command);
    }
    this.config.allowedCommands = this.config.allowedCommands.filter(c => c !== command);
    this.logger.info('Command removed from sandbox whitelist: %s', command);
  }
}
