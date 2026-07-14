import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinkDetector } from './link-detector.js';

describe('LinkDetector', () => {
  let detector: LinkDetector;

  beforeEach(() => {
    detector = new LinkDetector();
  });

  describe('detectLinks', () => {
    it('detects single URL', () => {
      const links = detector.detectLinks('Visit https://example.com for info');
      expect(links).toEqual(['https://example.com']);
    });

    it('detects multiple URLs', () => {
      const links = detector.detectLinks(
        'Check https://google.com and http://github.com/test'
      );
      expect(links).toHaveLength(2);
      expect(links).toContain('https://google.com');
      expect(links).toContain('http://github.com/test');
    });

    it('returns empty for no URLs', () => {
      const links = detector.detectLinks('No links here');
      expect(links).toEqual([]);
    });

    it('deduplicates URLs', () => {
      const links = detector.detectLinks(
        'Visit https://example.com and again https://example.com'
      );
      expect(links).toEqual(['https://example.com']);
    });
  });

  describe('hasLinks', () => {
    it('returns true when links present', () => {
      expect(detector.hasLinks('Visit https://example.com')).toBe(true);
    });

    it('returns false when no links', () => {
      expect(detector.hasLinks('No links here')).toBe(false);
    });
  });

  describe('getLinkInfo', () => {
    it('fetches link metadata', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html' },
        text: vi.fn().mockResolvedValue(`
          <html>
            <head>
              <title>Example Domain</title>
              <meta name="description" content="This is an example domain">
              <meta property="og:image" content="https://example.com/image.jpg">
            </head>
          </html>
        `),
      });

      vi.stubGlobal('fetch', mockFetch);

      const info = await detector.getLinkInfo('https://example.com');
      expect(info.url).toBe('https://example.com');
      expect(info.domain).toBe('example.com');
      expect(info.title).toBe('Example Domain');
      expect(info.description).toBe('This is an example domain');
      expect(info.image).toBe('https://example.com/image.jpg');

      vi.unstubAllGlobals();
    });

    it('handles fetch errors gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetch);

      const info = await detector.getLinkInfo('https://example.com');
      expect(info.url).toBe('https://example.com');
      expect(info.title).toBeUndefined();

      vi.unstubAllGlobals();
    });

    it('caches results', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html' },
        text: vi.fn().mockResolvedValue('<html><head><title>Cached</title></head></html>'),
      });

      vi.stubGlobal('fetch', mockFetch);

      await detector.getLinkInfo('https://example.com');
      await detector.getLinkInfo('https://example.com');

      expect(mockFetch).toHaveBeenCalledTimes(1); // Cached

      vi.unstubAllGlobals();
    });
  });

  describe('formatLinkPreview', () => {
    it('formats link with title and description', () => {
      const preview = detector.formatLinkPreview({
        url: 'https://example.com',
        domain: 'example.com',
        title: 'Example',
        description: 'An example site',
      });

      expect(preview).toContain('*Example*');
      expect(preview).toContain('An example site');
      expect(preview).toContain('https://example.com');
    });

    it('formats link without title', () => {
      const preview = detector.formatLinkPreview({
        url: 'https://example.com',
        domain: 'example.com',
      });

      expect(preview).toBe('https://example.com');
    });
  });
});
