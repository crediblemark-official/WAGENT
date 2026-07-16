import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebScraper } from '../rag/web-scraper.js';

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

const mockHttpClientGet = vi.fn();
vi.mock('../utils/http-client.js', () => ({
  HTTPClient: class { get = mockHttpClientGet; },
}));

const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Test Page</title>
  <meta name="description" content="A test description">
  <meta property="og:title" content="OG Title">
  <meta property="og:description" content="OG Desc">
  <meta property="og:image" content="https://example.com/og.png">
  <meta name="twitter:card" content="summary">
  <script>var x = 1;</script>
  <style>.red { color: red; }</style>
</head>
<body>
  <h1>Hello World</h1>
  <p>This is &amp; a &lt;test&gt; &quot;page&quot;.</p>
  <a href="/about">About</a>
  <a href="https://other.com/page">Other</a>
  <a href="#anchor">Anchor</a>
  <a href="javascript:void(0)">JS Link</a>
  <img src="/logo.png" alt="Logo">
  <img src="https://example.com/banner.jpg" alt="Banner">
  <img src="data:image/png;base64,abc" alt="Data URL">
</body>
</html>`;

describe('WebScraper', () => {
  let scraper: WebScraper;

  beforeEach(() => {
    vi.clearAllMocks();
    scraper = new WebScraper();
    mockHttpClientGet.mockResolvedValue({ ok: true, status: 200, body: SAMPLE_HTML, headers: {} });
  });

  describe('scrape', () => {
    it('returns ScrapedContent with url, title, content, links', async () => {
      const result = await scraper.scrape('https://example.com');
      expect(result).not.toBeNull();
      expect(result!.url).toBe('https://example.com');
      expect(typeof result!.title).toBe('string');
      expect(typeof result!.content).toBe('string');
      expect(Array.isArray(result!.links)).toBe(true);
    });

    it('extracts title from <title> tag', async () => {
      const result = await scraper.scrape('https://example.com');
      expect(result!.title).toBe('Test Page');
    });

    it('extracts meta description', async () => {
      const result = await scraper.scrape('https://example.com');
      expect(result!.description).toBe('A test description');
    });

    it('extracts text content (strips HTML tags)', async () => {
      const result = await scraper.scrape('https://example.com');
      expect(result!.content).toContain('Hello World');
      expect(result!.content).toContain('This is');
      expect(result!.content).not.toContain('<h1>');
      expect(result!.content).not.toContain('<body>');
    });

    it('extracts links (resolves relative URLs)', async () => {
      const result = await scraper.scrape('https://example.com');
      expect(result!.links).toContain('https://example.com/about');
      expect(result!.links).toContain('https://other.com/page');
    });

    it('extracts images', async () => {
      const result = await scraper.scrape('https://example.com');
      expect(result!.images).toContain('https://example.com/logo.png');
      expect(result!.images).toContain('https://example.com/banner.jpg');
    });

    it('extracts OG metadata', async () => {
      const result = await scraper.scrape('https://example.com');
      expect(result!.metadata['og:title']).toBe('OG Title');
      expect(result!.metadata['og:description']).toBe('OG Desc');
      expect(result!.metadata['og:image']).toBe('https://example.com/og.png');
      expect(result!.metadata['twitter:card']).toBe('summary');
    });

    it('returns null for already-scraped URL (dedup)', async () => {
      await scraper.scrape('https://example.com');
      const second = await scraper.scrape('https://example.com');
      expect(second).toBeNull();
    });

    it('returns null when maxPages exceeded', async () => {
      const limited = new WebScraper({ maxPages: 1 });
      await limited.scrape('https://example.com/page1');
      mockHttpClientGet.mockResolvedValue({ ok: true, status: 200, body: SAMPLE_HTML, headers: {} });
      const result = await limited.scrape('https://other.com/page2');
      expect(result).toBeNull();
    });
  });

  describe('scrapeAll', () => {
    it('processes multiple URLs', async () => {
      const results = await scraper.scrapeAll([
        'https://example.com',
        'https://example.com/page2',
      ]);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('skips failed URLs', async () => {
      mockHttpClientGet
        .mockResolvedValueOnce({ ok: true, status: 200, body: SAMPLE_HTML, headers: {} })
        .mockResolvedValueOnce({ ok: false, status: 404, body: '', headers: {} });

      const results = await scraper.scrapeAll([
        'https://example.com',
        'https://bad.com/404',
      ]);
      expect(results).toHaveLength(1);
    });
  });

  describe('search', () => {
    it('queries DuckDuckGo and scrapes results', async () => {
      const searchHTML = `
        <a class="result__a" href="https://duckduckgo.com/?uddg=https%3A%2F%2Fexample.com%2Fresult1&amp;...">Result 1</a>
        <a class="result__a" href="https://duckduckgo.com/?uddg=https%3A%2F%2Fexample.com%2Fresult2&amp;...">Result 2</a>
      `;
      mockHttpClientGet
        .mockResolvedValueOnce({ ok: true, status: 200, body: searchHTML, headers: {} })
        .mockResolvedValue({ ok: true, status: 200, body: SAMPLE_HTML, headers: {} });

      const results = await scraper.search('test query', 2);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty on error', async () => {
      mockHttpClientGet.mockRejectedValue(new Error('Network error'));
      const results = await scraper.search('test');
      expect(results).toEqual([]);
    });

    it('limits results', async () => {
      const searchHTML = Array.from({ length: 10 }, (_, i) =>
        `<a class="result__a" href="https://duckduckgo.com/?uddg=https%3A%2F%2Fexample.com%2Fpage${i}">Result ${i}</a>`
      ).join('');
      mockHttpClientGet
        .mockResolvedValueOnce({ ok: true, status: 200, body: searchHTML, headers: {} })
        .mockResolvedValue({ ok: true, status: 200, body: SAMPLE_HTML, headers: {} });

      const results = await scraper.search('test', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('clearCache', () => {
    it('resets dedup', async () => {
      await scraper.scrape('https://example.com');
      let second = await scraper.scrape('https://example.com');
      expect(second).toBeNull();

      scraper.clearCache();
      second = await scraper.scrape('https://example.com');
      expect(second).not.toBeNull();
    });
  });

  describe('HTML handling', () => {
    it('handles HTML entities', async () => {
      const result = await scraper.scrape('https://example.com');
      expect(result!.content).toContain('&');
      expect(result!.content).not.toContain('&amp;');
      expect(result!.content).not.toContain('&lt;');
      expect(result!.content).not.toContain('&gt;');
      expect(result!.content).not.toContain('&quot;');
    });

    it('strips script and style tags', async () => {
      const result = await scraper.scrape('https://example.com');
      expect(result!.content).not.toContain('var x = 1');
      expect(result!.content).not.toContain('.red');
    });

    it('rate limiting with delayMs', async () => {
      const start = Date.now();
      const slowScraper = new WebScraper({ delayMs: 50 });
      await slowScraper.scrape('https://example.com');
      mockHttpClientGet.mockResolvedValue({ ok: true, status: 200, body: SAMPLE_HTML, headers: {} });
      await slowScraper.scrape('https://example.com/other');
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });
});
