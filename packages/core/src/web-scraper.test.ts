import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebScraper } from './web-scraper.js';

describe('WebScraper', () => {
  let scraper: WebScraper;

  beforeEach(() => {
    scraper = new WebScraper({
      delayMs: 0, // No delay for tests
    });
  });

  describe('scrape', () => {
    it('scrapes a URL successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        text: vi.fn().mockResolvedValue(`
          <html>
            <head>
              <title>Test Page</title>
              <meta name="description" content="A test page">
            </head>
            <body>
              <h1>Hello World</h1>
              <p>This is a test page.</p>
              <a href="https://example.com/link">Link</a>
              <img src="https://example.com/image.jpg">
            </body>
          </html>
        `),
      });

      vi.stubGlobal('fetch', mockFetch);

      const content = await scraper.scrape('https://example.com');
      expect(content).not.toBeNull();
      expect(content!.title).toBe('Test Page');
      expect(content!.description).toBe('A test page');
      expect(content!.content).toContain('Hello World');
      expect(content!.links).toContain('https://example.com/link');
      expect(content!.images).toContain('https://example.com/image.jpg');

      vi.unstubAllGlobals();
    });

    it('blocks private IPs', async () => {
      const content = await scraper.scrape('http://localhost:3000');
      expect(content).toBeNull();
    });

    it('handles fetch errors', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Map(),
        text: vi.fn().mockResolvedValue('Not Found'),
      });

      vi.stubGlobal('fetch', mockFetch);

      const content = await scraper.scrape('https://example.com/404');
      expect(content).toBeNull();

      vi.unstubAllGlobals();
    });

    it('caches scraped URLs', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        text: vi.fn().mockResolvedValue('<html><head><title>Cached</title></head></html>'),
      });

      vi.stubGlobal('fetch', mockFetch);

      await scraper.scrape('https://example.com');
      await scraper.scrape('https://example.com'); // Should be cached

      expect(mockFetch).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });
  });

  describe('scrapeAll', () => {
    it('scrapes multiple URLs', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        text: vi.fn().mockResolvedValue('<html><head><title>Page</title></head></html>'),
      });

      vi.stubGlobal('fetch', mockFetch);

      const results = await scraper.scrapeAll([
        'https://example.com/1',
        'https://example.com/2',
        'https://example.com/3',
      ]);

      expect(results).toHaveLength(3);

      vi.unstubAllGlobals();
    });
  });

  describe('clearCache', () => {
    it('clears the cache', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        text: vi.fn().mockResolvedValue('<html></html>'),
      });

      vi.stubGlobal('fetch', mockFetch);

      await scraper.scrape('https://example.com');
      scraper.clearCache();
      await scraper.scrape('https://example.com'); // Should fetch again

      expect(mockFetch).toHaveBeenCalledTimes(2);

      vi.unstubAllGlobals();
    });
  });
});
