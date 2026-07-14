import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebScraper } from './web-scraper.js';

// Mock HTTPClient
vi.mock('./http-client.js', () => ({
  HTTPClient: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
  })),
}));

describe('WebScraper', () => {
  let scraper: WebScraper;
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { HTTPClient } = await import('./http-client.js');
    scraper = new WebScraper({ delayMs: 0 });
    mockGet = (scraper as any).httpClient.get;
  });

  describe('scrape', () => {
    it('scrapes a URL successfully', async () => {
      mockGet.mockResolvedValue({
        ok: true,
        body: `
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
        `,
      });

      const content = await scraper.scrape('https://example.com');
      expect(content).not.toBeNull();
      expect(content!.title).toBe('Test Page');
      expect(content!.description).toBe('A test page');
      expect(content!.content).toContain('Hello World');
      expect(content!.links).toContain('https://example.com/link');
      expect(content!.images).toContain('https://example.com/image.jpg');
    });

    it('handles fetch errors', async () => {
      mockGet.mockResolvedValue({ ok: false, body: '' });

      const content = await scraper.scrape('https://example.com/404');
      expect(content).toBeNull();
    });

    it('caches scraped URLs', async () => {
      mockGet.mockResolvedValue({
        ok: true,
        body: '<html><head><title>Cached</title></head></html>',
      });

      await scraper.scrape('https://example.com');
      await scraper.scrape('https://example.com'); // Should be cached

      expect(mockGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('scrapeAll', () => {
    it('scrapes multiple URLs', async () => {
      mockGet.mockResolvedValue({
        ok: true,
        body: '<html><head><title>Page</title></head></html>',
      });

      const results = await scraper.scrapeAll([
        'https://example.com/1',
        'https://example.com/2',
        'https://example.com/3',
      ]);

      expect(results).toHaveLength(3);
    });
  });

  describe('clearCache', () => {
    it('clears the cache', async () => {
      mockGet.mockResolvedValue({
        ok: true,
        body: '<html></html>',
      });

      await scraper.scrape('https://example.com');
      scraper.clearCache();
      await scraper.scrape('https://example.com'); // Should fetch again

      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });
});
