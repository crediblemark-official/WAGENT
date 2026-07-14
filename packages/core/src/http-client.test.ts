import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPClient } from './http-client.js';

describe('HTTPClient', () => {
  let client: HTTPClient;

  beforeEach(() => {
    client = new HTTPClient({
      blockedDomains: ['localhost', '127.0.0.1'],
    });
  });

  describe('get', () => {
    it('fetches URL successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/html']]),
        text: vi.fn().mockResolvedValue('<html>Success</html>'),
      });

      vi.stubGlobal('fetch', mockFetch);

      const response = await client.get('https://example.com');
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(response.body).toContain('Success');

      vi.unstubAllGlobals();
    });

    it('blocks localhost', async () => {
      const response = await client.get('http://localhost:3000/secret');
      expect(response.ok).toBe(false);
      expect(response.body).toContain('blocked');
    });

    it('blocks private IPs', async () => {
      const response = await client.get('http://192.168.1.1/admin');
      expect(response.ok).toBe(false);
      expect(response.body).toContain('private');
    });

    it('handles invalid URLs', async () => {
      const response = await client.get('not-a-url');
      expect(response.ok).toBe(false);
      expect(response.body).toContain('Invalid URL');
    });
  });

  describe('domain whitelist', () => {
    it('allows whitelisted domains', async () => {
      const allowedClient = new HTTPClient({
        allowedDomains: ['api.example.com'],
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        text: vi.fn().mockResolvedValue('ok'),
      });

      vi.stubGlobal('fetch', mockFetch);

      const response = await allowedClient.get('https://api.example.com/data');
      expect(response.ok).toBe(true);

      vi.unstubAllGlobals();
    });

    it('blocks non-whitelisted domains', async () => {
      const allowedClient = new HTTPClient({
        allowedDomains: ['api.example.com'],
      });

      const response = await allowedClient.get('https://evil.com/steal');
      expect(response.ok).toBe(false);
      expect(response.body).toContain('not in the allowed list');
    });
  });

  describe('post', () => {
    it('sends POST request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Map(),
        text: vi.fn().mockResolvedValue('created'),
      });

      vi.stubGlobal('fetch', mockFetch);

      const response = await client.post('https://api.example.com/data', { key: 'value' });
      expect(response.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ key: 'value' }),
        })
      );

      vi.unstubAllGlobals();
    });
  });

  describe('SSRF protection', () => {
    it('blocks 127.0.0.1', async () => {
      const response = await client.get('http://127.0.0.1/admin');
      expect(response.ok).toBe(false);
      expect(response.body).toContain('blocked');
    });

    it('blocks 10.x.x.x private IPs', async () => {
      const response = await client.get('http://10.0.0.1/admin');
      expect(response.ok).toBe(false);
    });

    it('blocks 172.16.x.x private IPs', async () => {
      const response = await client.get('http://172.16.0.1/admin');
      expect(response.ok).toBe(false);
    });

    it('blocks 0.0.0.0', async () => {
      const response = await client.get('http://0.0.0.0/admin');
      expect(response.ok).toBe(false);
    });
  });

  describe('timeout', () => {
    it('handles timeout errors gracefully', async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        new Promise((_, reject) => setTimeout(() => reject(new Error('Aborted')), 100))
      );
      vi.stubGlobal('fetch', mockFetch);

      const response = await client.get('https://slow.example.com');
      expect(response.ok).toBe(false);

      vi.unstubAllGlobals();
    });
  });

  describe('network errors', () => {
    it('handles fetch exceptions', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('DNS resolution failed'));
      vi.stubGlobal('fetch', mockFetch);

      const response = await client.get('https://nonexistent.invalid');
      expect(response.ok).toBe(false);
      expect(response.body).toContain('DNS resolution failed');

      vi.unstubAllGlobals();
    });
  });

  describe('response truncation', () => {
    it('truncates large responses exceeding maxResponseSize', async () => {
      const smallClient = new HTTPClient({
        blockedDomains: [],
        maxResponseSize: 100,
      });

      const largeBody = 'x'.repeat(200);
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        text: vi.fn().mockResolvedValue(largeBody),
      });
      vi.stubGlobal('fetch', mockFetch);

      const response = await smallClient.get('https://large.example.com');
      expect(response.ok).toBe(true);
      expect(response.body).toContain('truncated');
      expect(response.body).not.toBe(largeBody);

      vi.unstubAllGlobals();
    });
  });
});
