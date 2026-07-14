import { Logger } from 'pino';
import { getLogger } from './logger.js';

export interface HTTPConfig {
  /** Allowed domains (empty = all allowed) */
  allowedDomains: string[];
  /** Blocked domains */
  blockedDomains: string[];
  /** Max response size in bytes (default: 1MB) */
  maxResponseSize?: number;
  /** Request timeout in ms (default: 10000) */
  timeoutMs?: number;
  /** Default headers */
  defaultHeaders?: Record<string, string>;
}

export interface HTTPResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  ok: boolean;
  url: string;
}

const DEFAULT_CONFIG: HTTPConfig = {
  allowedDomains: [],
  blockedDomains: ['localhost', '127.0.0.1', '0.0.0.0'],
  maxResponseSize: 1024 * 1024, // 1MB
  timeoutMs: 10000,
  defaultHeaders: {
    'User-Agent': 'WAGENT/1.0',
  },
};

/**
 * HTTPClient makes HTTP requests with domain whitelist restrictions.
 * - Blocks requests to internal/private IPs (SSRF protection)
 * - Validates domains against whitelist/blacklist
 * - Limits response size
 * - Timeout protection
 */
export class HTTPClient {
  private logger: Logger;
  private config: HTTPConfig;

  constructor(config: Partial<HTTPConfig> = {}) {
    this.logger = getLogger().child({ module: 'http-client' });
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Make a GET request
   */
  async get(url: string, headers?: Record<string, string>): Promise<HTTPResponse> {
    return this.request('GET', url, undefined, headers);
  }

  /**
   * Make a POST request
   */
  async post(
    url: string,
    body: any,
    headers?: Record<string, string>
  ): Promise<HTTPResponse> {
    return this.request('POST', url, body, headers);
  }

  /**
   * Make a request
   */
  async request(
    method: string,
    url: string,
    body?: any,
    headers?: Record<string, string>
  ): Promise<HTTPResponse> {
    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return {
        status: 0,
        headers: {},
        body: 'Invalid URL',
        ok: false,
        url,
      };
    }

    // Check domain restrictions
    const domainError = this.checkDomain(parsedUrl.hostname);
    if (domainError) {
      this.logger.warn({ url, error: domainError }, 'Domain blocked');
      return {
        status: 0,
        headers: {},
        body: domainError,
        ok: false,
        url,
      };
    }

    // Check for private IPs (SSRF protection)
    if (await this.isPrivateIP(parsedUrl.hostname)) {
      this.logger.warn({ url }, 'Private IP blocked (SSRF protection)');
      return {
        status: 0,
        headers: {},
        body: 'Requests to private IPs are blocked',
        ok: false,
        url,
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.timeoutMs || 10000
      );

      const requestHeaders = {
        ...this.config.defaultHeaders,
        ...headers,
      };

      const fetchOptions: RequestInit = {
        method,
        headers: requestHeaders,
        signal: controller.signal,
      };

      if (body && method !== 'GET') {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        if (!requestHeaders['Content-Type']) {
          (requestHeaders as any)['Content-Type'] = 'application/json';
        }
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeout);

      // Check response size
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > (this.config.maxResponseSize || 1024 * 1024)) {
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: 'Response too large',
          ok: false,
          url,
        };
      }

      const text = await response.text();

      // Check actual size
      if (text.length > (this.config.maxResponseSize || 1024 * 1024)) {
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: text.slice(0, 10000) + '... (truncated)',
          ok: response.ok,
          url,
        };
      }

      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: text,
        ok: response.ok,
        url,
      };
    } catch (err: any) {
      this.logger.error({ url, error: err.message }, 'HTTP request failed');
      return {
        status: 0,
        headers: {},
        body: err.message,
        ok: false,
        url,
      };
    }
  }

  /**
   * Check if domain is allowed
   */
  private checkDomain(hostname: string): string | null {
    // Check blocked domains
    for (const blocked of this.config.blockedDomains) {
      if (hostname === blocked || hostname.endsWith('.' + blocked)) {
        return `Domain '${hostname}' is blocked`;
      }
    }

    // Check allowed domains (if specified)
    if (this.config.allowedDomains.length > 0) {
      const isAllowed = this.config.allowedDomains.some(
        (allowed) => hostname === allowed || hostname.endsWith('.' + allowed)
      );
      if (!isAllowed) {
        return `Domain '${hostname}' is not in the allowed list`;
      }
    }

    return null;
  }

  /**
   * Check if hostname is a private IP (SSRF protection)
   */
  private async isPrivateIP(hostname: string): Promise<boolean> {
    // Check for IP patterns
    const ipPatterns = [
      /^127\./, // Loopback
      /^10\./, // Private Class A
      /^172\.(1[6-9]|2[0-9]|3[01])\./, // Private Class B
      /^192\.168\./, // Private Class C
      /^0\./, // Current network
      /^localhost$/i,
      /^::1$/, // IPv6 loopback
      /^\[::1\]$/, // IPv6 loopback
    ];

    for (const pattern of ipPatterns) {
      if (pattern.test(hostname)) {
        return true;
      }
    }

    return false;
  }
}
