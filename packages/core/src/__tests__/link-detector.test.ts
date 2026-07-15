import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinkDetector, LinkInfo } from '../link-detector.js';

vi.mock('../logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  }),
}));

describe('LinkDetector', () => {
  let detector: LinkDetector;

  beforeEach(() => {
    detector = new LinkDetector();
  });

  describe('detectLinks', () => {
    it('should detect single URL', () => {
      expect(detector.detectLinks('Visit https://example.com')).toEqual(['https://example.com']);
    });

    it('should detect multiple URLs', () => {
      const msg = 'See https://a.com and http://b.com/path?q=1';
      const links = detector.detectLinks(msg);
      expect(links).toHaveLength(2);
      expect(links).toContain('https://a.com');
      expect(links).toContain('http://b.com/path?q=1');
    });

    it('should deduplicate URLs', () => {
      const msg = 'Visit https://a.com and https://a.com again';
      expect(detector.detectLinks(msg)).toEqual(['https://a.com']);
    });

    it('should return empty for no URLs', () => {
      expect(detector.detectLinks('Hello world')).toEqual([]);
    });

    it('should handle URLs with special chars', () => {
      const msg = 'https://example.com/path?q=1&r=2#frag';
      expect(detector.detectLinks(msg)).toEqual(['https://example.com/path?q=1&r=2#frag']);
    });
  });

  describe('hasLinks', () => {
    it('should return true when links present', () => {
      expect(detector.hasLinks('Check https://example.com')).toBe(true);
    });

    it('should return false when no links', () => {
      expect(detector.hasLinks('No links here')).toBe(false);
    });
  });

  describe('formatLinkPreview', () => {
    it('should format with title and description', () => {
      const info: LinkInfo = {
        url: 'https://example.com',
        domain: 'example.com',
        title: 'Example Site',
        description: 'A great website for examples.',
      };
      const result = detector.formatLinkPreview(info);
      expect(result).toContain('*Example Site*');
      expect(result).toContain('A great website for examples.');
      expect(result).toContain('https://example.com');
    });

    it('should format with just URL', () => {
      const info: LinkInfo = { url: 'https://example.com', domain: 'example.com' };
      const result = detector.formatLinkPreview(info);
      expect(result).toBe('https://example.com');
    });

    it('should truncate long descriptions', () => {
      const info: LinkInfo = {
        url: 'https://example.com',
        domain: 'example.com',
        description: 'A'.repeat(150),
      };
      const result = detector.formatLinkPreview(info);
      expect(result).toContain('...');
    });
  });

  describe('getLinkInfo', () => {
    it('should return basic info on fetch failure', async () => {
      const spy = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', spy);
      try {
        const info = await detector.getLinkInfo('https://example.com');
        expect(info.url).toBe('https://example.com');
        expect(info.domain).toBe('example.com');
        expect(info.title).toBeUndefined();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('should return basic info on non-ok response', async () => {
      const spy = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: () => 'text/html' },
      });
      vi.stubGlobal('fetch', spy);
      try {
        const info = await detector.getLinkInfo('https://example.com');
        expect(info.url).toBe('https://example.com');
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('should return basic info for non-HTML content', async () => {
      const spy = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
      });
      vi.stubGlobal('fetch', spy);
      try {
        const info = await detector.getLinkInfo('https://example.com');
        expect(info.title).toBeUndefined();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('should parse HTML metadata', async () => {
      const html = `
        <html>
          <head>
            <title>My Page</title>
            <meta name="description" content="A cool page">
            <meta property="og:image" content="/img/og.png">
            <link rel="icon" href="/favicon.ico">
          </head>
          <body></body>
        </html>
      `;
      const spy = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html; charset=utf-8' },
        text: async () => html,
      });
      vi.stubGlobal('fetch', spy);
      try {
        const info = await detector.getLinkInfo('https://example.com');
        expect(info.title).toBe('My Page');
        expect(info.description).toBe('A cool page');
        expect(info.image).toBe('https://example.com/img/og.png');
        expect(info.favicon).toBe('https://example.com/favicon.ico');
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('should use cached result within TTL', async () => {
      const spy = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html' },
        text: async () => '<html><head><title>Cached</title></head></html>',
      });
      vi.stubGlobal('fetch', spy);
      try {
        await detector.getLinkInfo('https://example.com');
        await detector.getLinkInfo('https://example.com'); // should use cache
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('should handle meta description with content before name', async () => {
      const html = `<html><head><meta content="Desc first" name="description"></head></html>`;
      const spy = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html' },
        text: async () => html,
      });
      vi.stubGlobal('fetch', spy);
      try {
        const info = await detector.getLinkInfo('https://example.com');
        expect(info.description).toBe('Desc first');
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('should handle og:image with content before property', async () => {
      const html = `<html><head><meta content="/img.jpg" property="og:image"></head></html>`;
      const spy = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html' },
        text: async () => html,
      });
      vi.stubGlobal('fetch', spy);
      try {
        const info = await detector.getLinkInfo('https://example.com');
        expect(info.image).toBe('https://example.com/img.jpg');
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('should handle favicon with href before rel', async () => {
      const html = `<html><head><link href="/fav.png" rel="icon"></head></html>`;
      const spy = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html' },
        text: async () => html,
      });
      vi.stubGlobal('fetch', spy);
      try {
        const info = await detector.getLinkInfo('https://example.com');
        expect(info.favicon).toBe('https://example.com/fav.png');
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  describe('getLinksInfo', () => {
    it('should return info for all links', async () => {
      const spy = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html' },
        text: async () => '<html><head><title>Page</title></head></html>',
      });
      vi.stubGlobal('fetch', spy);
      try {
        const results = await detector.getLinksInfo('Visit https://a.com and https://b.com');
        expect(results).toHaveLength(2);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });
});
