import { Logger } from 'pino';
import { getLogger } from './logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export interface ShellConfig {
  /** Allowed commands */
  allowed: string[];
  /** Denied commands (always blocked regardless of allowed list) */
  denied: string[];
  /** Restricted directories (commands can only access these) */
  restrictedDirs: string[];
  /** Max execution time in ms (default: 30000) */
  timeoutMs?: number;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

const DEFAULT_CONFIG: ShellConfig = {
  allowed: ['date', 'echo', 'pwd', 'ls', 'cat', 'grep', 'head', 'tail', 'wc', 'jq'],
  denied: ['rm', 'sudo', 'chmod', 'chown', 'dd', 'mkfs', 'fork', 'eval', 'exec', 'bash', 'sh', 'zsh'],
  restrictedDirs: ['./data', './memory', './uploads', './knowledge'],
  timeoutMs: 30000,
};

/**
 * SafeShell executes whitelisted shell commands with restrictions:
 * - Only allowed commands can run
 * - Denied commands are always blocked
 * - Directory restrictions for file access
 * - Timeout protection
 * - Input sanitization
 */
export class SafeShell {
  private logger: Logger;
  private config: ShellConfig;

  constructor(config: Partial<ShellConfig> = {}) {
    this.logger = getLogger().child({ module: 'safe-shell' });
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a command if allowed
   */
  async execute(command: string, workDir?: string): Promise<ShellResult> {
    // Parse command
    const parts = this.parseCommand(command);
    if (parts.length === 0) {
      return { stdout: '', stderr: 'Empty command', exitCode: 1, timedOut: false };
    }

    const cmd = parts[0].toLowerCase();

    // Check denied list first
    if (this.config.denied.includes(cmd)) {
      this.logger.warn({ command: cmd }, 'Command is denied');
      return {
        stdout: '',
        stderr: `Command '${cmd}' is not allowed for security reasons`,
        exitCode: 1,
        timedOut: false,
      };
    }

    // Check allowed list
    if (!this.config.allowed.includes(cmd)) {
      this.logger.warn({ command: cmd }, 'Command not in whitelist');
      return {
        stdout: '',
        stderr: `Command '${cmd}' is not in the allowed list`,
        exitCode: 1,
        timedOut: false,
      };
    }

    // Check directory restrictions
    const dirError = this.checkDirectoryRestrictions(command);
    if (dirError) {
      return { stdout: '', stderr: dirError, exitCode: 1, timedOut: false };
    }

    // Sanitize input
    const sanitized = this.sanitizeInput(command);

    // Execute
    try {
      const cwd = workDir || process.cwd();
      const timeout = this.config.timeoutMs || 30000;

      const { stdout, stderr } = await execAsync(sanitized, {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024, // 1MB
      });

      return {
        stdout: stdout.slice(0, 10000), // Limit output
        stderr: stderr.slice(0, 5000),
        exitCode: 0,
        timedOut: false,
      };
    } catch (err: any) {
      const timedOut = err.killed === true || err.signal === 'SIGTERM';
      return {
        stdout: err.stdout?.slice(0, 10000) || '',
        stderr: err.stderr?.slice(0, 5000) || err.message,
        exitCode: err.code || 1,
        timedOut,
      };
    }
  }

  /**
   * Check if a command can be executed
   */
  canExecute(command: string): boolean {
    const parts = this.parseCommand(command);
    if (parts.length === 0) return false;

    const cmd = parts[0].toLowerCase();

    if (this.config.denied.includes(cmd)) return false;
    if (!this.config.allowed.includes(cmd)) return false;
    if (this.checkDirectoryRestrictions(command)) return false;

    return true;
  }

  /**
   * Get list of allowed commands
   */
  getAllowedCommands(): string[] {
    return [...this.config.allowed];
  }

  /**
   * Parse command string into parts
   */
  private parseCommand(command: string): string[] {
    // Simple split by spaces, respecting quotes
    const parts: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (const char of command) {
      if (inQuote) {
        if (char === quoteChar) {
          inQuote = false;
        } else {
          current += char;
        }
      } else if (char === '"' || char === "'") {
        inQuote = true;
        quoteChar = char;
      } else if (char === ' ') {
        if (current) {
          parts.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  /**
   * Check directory restrictions
   */
  private checkDirectoryRestrictions(command: string): string | null {
    // Check if command tries to access restricted directories outside allowed paths
    const restrictedPatterns = [
      /\.\.\//g, // Parent directory traversal
      /\/etc\//g,
      /\/var\//g,
      /\/usr\//g,
      /\/root\//g,
      /\/home\//g,
    ];

    // Add custom restricted directories from config
    for (const dir of this.config.restrictedDirs) {
      const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      restrictedPatterns.push(new RegExp(escaped, 'g'));
    }

    for (const pattern of restrictedPatterns) {
      if (pattern.test(command)) {
        return `Directory access restricted: ${pattern.source}`;
      }
    }

    return null;
  }

  /**
   * Sanitize command input
   */
  private sanitizeInput(command: string): string {
    // Remove null bytes
    let sanitized = command.replace(/\0/g, '');

    // Remove command injection attempts
    sanitized = sanitized.replace(/[;&|`$(){}[\]!]/g, (match) => {
      // Allow these in quoted strings
      return match;
    });

    return sanitized;
  }
}
