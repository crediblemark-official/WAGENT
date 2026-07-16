import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  }),
}));

function mockFetch(response: Partial<Response> & { body?: string }) {
  const spy = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Map(),
    text: async () => response.body ?? '',
    ...response,
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function okResponse(body: string, status = 200, headers: Record<string, string> = {}) {
  const headerMap = new Map(Object.entries(headers));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key: string) => headerMap.get(key) ?? null,
      entries: () => headerMap.entries(),
    },
    text: async () => body,
  };
}

describe('HTTPClient', () => {
  let HTTPClient: typeof import('../utils/http-client.js').HTTPClient;

  beforeEach(async () => {
    vi.restoreAllMocks();
    const mod = await import('../utils/http-client.js');
    HTTPClient = mod.HTTPClient;
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const client = new HTTPClient();
      expect(client).toBeDefined();
    });

    it('should accept partial config', () => {
      const client = new HTTPClient({
        timeoutMs: 5000,
        maxResponseSize: 2048,
      });
      expect(client).toBeDefined();
    });
  });

  describe('get - successful request', () => {
    it('should return response body on success', async () => {
      const spy = mockFetch(okResponse('hello world'));
      const client = new HTTPClient();
      const res = await client.get('https://example.com/api');

      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.body).toBe('hello world');
      expect(res.url).toBe('https://example.com/api');
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should use GET method', async () => {
      const spy = mockFetch(okResponse('ok'));
      const client = new HTTPClient();
      await client.get('https://example.com');

      expect(spy).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should return headers from response', async () => {
      mockFetch(okResponse('data', 200, { 'x-request-id': 'abc' }));
      const client = new HTTPClient();
      const res = await client.get('https://example.com');

      expect(res.headers['x-request-id']).toBe('abc');
    });
  });

  describe('get - with headers', () => {
    it('should merge custom headers with defaults', async () => {
      const spy = mockFetch(okResponse('ok'));
      const client = new HTTPClient();
      await client.get('https://example.com', { Authorization: 'Bearer token' });

      expect(spy).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token',
            'User-Agent': 'WAGENT/1.0',
          }),
        }),
      );
    });

    it('should allow overriding default headers', async () => {
      const spy = mockFetch(okResponse('ok'));
      const client = new HTTPClient();
      await client.get('https://example.com', { 'User-Agent': 'CustomAgent/2.0' });

      expect(spy).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: expect.objectContaining({ 'User-Agent': 'CustomAgent/2.0' }),
        }),
      );
    });
  });

  describe('post - successful request with body', () => {
    it('should send POST with JSON body', async () => {
      const spy = mockFetch(okResponse('created'));
      const client = new HTTPClient();
      const res = await client.post('https://example.com/api', { key: 'value' });

      expect(res.ok).toBe(true);
      expect(res.body).toBe('created');
      expect(spy).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ key: 'value' }),
        }),
      );
    });

    it('should set Content-Type to application/json by default', async () => {
      const spy = mockFetch(okResponse('ok'));
      const client = new HTTPClient();
      await client.post('https://example.com/api', { data: 1 });

      expect(spy).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('should not override Content-Type if already set', async () => {
      const spy = mockFetch(okResponse('ok'));
      const client = new HTTPClient();
      await client.post(
        'https://example.com/api',
        'raw body',
        { 'Content-Type': 'text/plain' },
      );

      expect(spy).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'text/plain',
          }),
        }),
      );
    });

    it('should send string body as-is', async () => {
      const spy = mockFetch(okResponse('ok'));
      const client = new HTTPClient();
      await client.post('https://example.com/api', 'raw text');

      expect(spy).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({ body: 'raw text' }),
      );
    });

    it('should not attach body for GET requests', async () => {
      const spy = mockFetch(okResponse('ok'));
      const client = new HTTPClient();
      await client.get('https://example.com');

      const callArgs = spy.mock.calls[0][1];
      expect(callArgs.body).toBeUndefined();
    });
  });

  describe('SSRF protection - blocks private IPs', () => {
    it('should block 127.x.x.x', async () => {
      const client = new HTTPClient({ blockedDomains: [] });
      const res = await client.get('http://127.0.0.1/admin');

      expect(res.ok).toBe(false);
      expect(res.status).toBe(0);
      expect(res.body).toBe('Requests to private IPs are blocked');
    });

    it('should block 10.x.x.x', async () => {
      const client = new HTTPClient();
      const res = await client.get('http://10.0.0.1/internal');

      expect(res.ok).toBe(false);
      expect(res.body).toBe('Requests to private IPs are blocked');
    });

    it('should block 192.168.x.x', async () => {
      const client = new HTTPClient();
      const res = await client.get('http://192.168.1.1/router');

      expect(res.ok).toBe(false);
      expect(res.body).toBe('Requests to private IPs are blocked');
    });

    it('should block 172.16-31.x.x (private Class B)', async () => {
      const client = new HTTPClient();
      expect((await client.get('http://172.16.0.1/test')).ok).toBe(false);
      expect((await client.get('http://172.31.255.255/test')).ok).toBe(false);
    });

    it('should block 0.x.x.x', async () => {
      const client = new HTTPClient();
      const res = await client.get('http://0.0.0.0/test');

      expect(res.ok).toBe(false);
    });

    it('should not make a fetch call when blocked', async () => {
      const spy = mockFetch(okResponse('should not reach'));
      const client = new HTTPClient();
      await client.get('http://127.0.0.1/admin');

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('SSRF protection - blocks localhost', () => {
    it('should block localhost via blacklist', async () => {
      const client = new HTTPClient();
      const res = await client.get('http://localhost:3000/api');

      expect(res.ok).toBe(false);
      expect(res.status).toBe(0);
      expect(res.body).toContain('blocked');
    });

    it('should block localhost case-insensitively', async () => {
      const client = new HTTPClient();
      const res = await client.get('http://LOCALHOST/api');

      expect(res.ok).toBe(false);
    });

    it('should block IPv6 loopback', async () => {
      const client = new HTTPClient();
      const res = await client.get('http://[::1]/test');

      expect(res.ok).toBe(false);
      expect(res.body).toBe('Requests to private IPs are blocked');
    });
  });

  describe('domain whitelist', () => {
    it('should allow configured domains', async () => {
      const spy = mockFetch(okResponse('allowed'));
      const client = new HTTPClient({
        allowedDomains: ['example.com'],
      });
      const res = await client.get('https://example.com/page');

      expect(res.ok).toBe(true);
      expect(res.body).toBe('allowed');
    });

    it('should allow subdomains of whitelisted domains', async () => {
      const spy = mockFetch(okResponse('subdomain ok'));
      const client = new HTTPClient({
        allowedDomains: ['example.com'],
      });
      const res = await client.get('https://api.example.com/data');

      expect(res.ok).toBe(true);
      expect(res.body).toBe('subdomain ok');
    });

    it('should block non-whitelisted domains', async () => {
      const spy = mockFetch(okResponse('should not reach'));
      const client = new HTTPClient({
        allowedDomains: ['example.com'],
      });
      const res = await client.get('https://evil.com/steal');

      expect(res.ok).toBe(false);
      expect(res.status).toBe(0);
      expect(res.body).toContain('not in the allowed list');
      expect(spy).not.toHaveBeenCalled();
    });

    it('should allow all domains when allowedDomains is empty', async () => {
      const spy = mockFetch(okResponse('open'));
      const client = new HTTPClient({ allowedDomains: [] });
      const res = await client.get('https://any-domain.com');

      expect(res.ok).toBe(true);
    });
  });

  describe('domain blacklist', () => {
    it('should block localhost by default', async () => {
      const spy = mockFetch(okResponse('nope'));
      const client = new HTTPClient();
      const res = await client.get('http://localhost/admin');

      expect(res.ok).toBe(false);
      expect(res.body).toContain('blocked');
      expect(spy).not.toHaveBeenCalled();
    });

    it('should block 127.0.0.1 by default', async () => {
      const spy = mockFetch(okResponse('nope'));
      const client = new HTTPClient();
      const res = await client.get('http://127.0.0.1/admin');

      expect(res.ok).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it('should block 0.0.0.0 by default', async () => {
      const client = new HTTPClient();
      const res = await client.get('http://0.0.0.0/test');

      expect(res.ok).toBe(false);
    });

    it('should block custom blocked domains', async () => {
      const spy = mockFetch(okResponse('nope'));
      const client = new HTTPClient({
        blockedDomains: ['evil.com'],
      });
      const res = await client.get('https://evil.com/steal');

      expect(res.ok).toBe(false);
      expect(res.body).toContain('blocked');
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('response size limit', () => {
    it('should reject responses exceeding content-length limit', async () => {
      const spy = mockFetch(okResponse('big body', 200, {
        'content-length': String(2 * 1024 * 1024),
      }));
      const client = new HTTPClient();
      const res = await client.get('https://example.com/large');

      expect(res.ok).toBe(false);
      expect(res.body).toBe('Response too large');
    });

    it('should reject responses exceeding body size limit', async () => {
      const largeBody = 'x'.repeat(2 * 1024 * 1024);
      mockFetch(okResponse(largeBody));
      const client = new HTTPClient();
      const res = await client.get('https://example.com/large');

      expect(res.body).toContain('truncated');
      expect(res.body.length).toBeLessThan(largeBody.length);
    });

    it('should accept responses within size limit', async () => {
      mockFetch(okResponse('small body'));
      const client = new HTTPClient({ maxResponseSize: 1024 * 1024 });
      const res = await client.get('https://example.com/small');

      expect(res.ok).toBe(true);
      expect(res.body).toBe('small body');
    });

    it('should use custom maxResponseSize', async () => {
      const spy = mockFetch(okResponse('a'.repeat(200), 200, {
        'content-length': '200',
      }));
      const client = new HTTPClient({ maxResponseSize: 100 });
      const res = await client.get('https://example.com');

      expect(res.ok).toBe(false);
      expect(res.body).toBe('Response too large');
    });
  });

  describe('timeout handling', () => {
    it('should pass an AbortSignal to fetch', async () => {
      const spy = mockFetch(okResponse('ok'));
      const client = new HTTPClient();
      await client.get('https://example.com');

      const callOpts = spy.mock.calls[0][1] as RequestInit;
      expect(callOpts.signal).toBeInstanceOf(AbortSignal);
    });

    it('should set timeout to abort controller', async () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      mockFetch(okResponse('ok'));
      const client = new HTTPClient({ timeoutMs: 5000 });
      await client.get('https://example.com');

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
      vi.restoreAllMocks();
    });

    it('should use default timeout of 10000ms', async () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      mockFetch(okResponse('ok'));
      const client = new HTTPClient();
      await client.get('https://example.com');

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10000);
      vi.restoreAllMocks();
    });
  });

  describe('error handling', () => {
    it('should handle network errors', async () => {
      const spy = vi.fn().mockRejectedValue(new Error('Network failure'));
      vi.stubGlobal('fetch', spy);

      try {
        const client = new HTTPClient();
        const res = await client.get('https://example.com');

        expect(res.ok).toBe(false);
        expect(res.status).toBe(0);
        expect(res.body).toBe('Network failure');
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('should handle DNS resolution failures', async () => {
      const spy = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
      vi.stubGlobal('fetch', spy);

      try {
        const client = new HTTPClient();
        const res = await client.get('https://nonexistent.invalid');

        expect(res.ok).toBe(false);
        expect(res.body).toContain('ENOTFOUND');
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('should handle non-ok HTTP status', async () => {
      mockFetch(okResponse('Not Found', 404));
      const client = new HTTPClient();
      const res = await client.get('https://example.com/missing');

      expect(res.ok).toBe(false);
      expect(res.status).toBe(404);
      expect(res.body).toBe('Not Found');
    });

    it('should handle 500 server error', async () => {
      mockFetch(okResponse('Internal Server Error', 500));
      const client = new HTTPClient();
      const res = await client.get('https://example.com/crash');

      expect(res.ok).toBe(false);
      expect(res.status).toBe(500);
    });
  });

  describe('invalid URL', () => {
    it('should return error for invalid URL', async () => {
      const client = new HTTPClient();
      const res = await client.get('not-a-url');

      expect(res.ok).toBe(false);
      expect(res.status).toBe(0);
      expect(res.body).toBe('Invalid URL');
    });

    it('should return error for empty string URL', async () => {
      const client = new HTTPClient();
      const res = await client.get('');

      expect(res.ok).toBe(false);
      expect(res.body).toBe('Invalid URL');
    });
  });

  describe('request method', () => {
    it('should support PUT method', async () => {
      const spy = mockFetch(okResponse('updated'));
      const client = new HTTPClient();
      await client.request('PUT', 'https://example.com/resource', { data: 1 });

      expect(spy).toHaveBeenCalledWith(
        'https://example.com/resource',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    it('should support DELETE method', async () => {
      const spy = mockFetch(okResponse('deleted'));
      const client = new HTTPClient();
      await client.request('DELETE', 'https://example.com/resource');

      expect(spy).toHaveBeenCalledWith(
        'https://example.com/resource',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('should attach abort signal to request', async () => {
      const spy = mockFetch(okResponse('ok'));
      const client = new HTTPClient();
      await client.get('https://example.com');

      expect(spy).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });
  });
});
