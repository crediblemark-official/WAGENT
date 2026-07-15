import { Logger } from 'pino';
import { getLogger } from './logger.js';

export interface LinkInfo {
  url: string;
  domain: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
}

/**
 * LinkDetector detects URLs in messages and optionally
 * fetches metadata (title, description, image) for link previews.
 */
export class LinkDetector {
  private logger: Logger;
  private cache: Map<string, LinkInfo> = new Map();
  private cacheMaxAge = 5 * 60 * 1000; // 5 minutes
  private cacheTimestamps: Map<string, number> = new Map();

  constructor() {
    this.logger = getLogger().child({ module: 'link-detector' });
  }

  /**
   * Detect all URLs in a message
   */
  detectLinks(message: string): string[] {
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
    const matches = message.match(urlRegex) || [];
    return [...new Set(matches)]; // Deduplicate
  }

  /**
   * Check if message contains any links
   */
  hasLinks(message: string): boolean {
    return this.detectLinks(message).length > 0;
  }

  /**
   * Get metadata for a URL (with caching)
   */
  async getLinkInfo(url: string): Promise<LinkInfo> {
    // Check cache
    const cached = this.cache.get(url);
    const timestamp = this.cacheTimestamps.get(url);
    if (cached && timestamp && Date.now() - timestamp < this.cacheMaxAge) {
      return cached;
    }

    const domain = this.extractDomain(url);
    const info: LinkInfo = { url, domain };

    try {
      // Fetch page metadata
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'WAGENT/1.0 (link-preview)',
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        this.logger.debug({ url, status: response.status }, 'Failed to fetch link metadata');
        this.cacheLink(url, info);
        return info;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        this.cacheLink(url, info);
        return info;
      }

      const html = await response.text();
      const metadata = this.parseHTMLMetadata(html);

      info.title = metadata.title;
      info.description = metadata.description;
      info.image = this.resolveUrl(url, metadata.image);
      info.favicon = this.resolveUrl(url, metadata.favicon);

      this.logger.debug({ url, title: info.title }, 'Fetched link metadata');
    } catch (err: any) {
      this.logger.debug({ url, error: err.message }, 'Error fetching link metadata');
    }

    this.cacheLink(url, info);
    return info;
  }

  /**
   * Get metadata for all links in a message
   */
  async getLinksInfo(message: string): Promise<LinkInfo[]> {
    const urls = this.detectLinks(message);
    return Promise.all(urls.map((url) => this.getLinkInfo(url)));
  }

  /**
   * Format link info for display
   */
  formatLinkPreview(info: LinkInfo): string {
    const lines: string[] = [];

    if (info.title) {
      lines.push(`*${info.title}*`);
    }

    if (info.description) {
      const desc = info.description.length > 100
        ? info.description.slice(0, 100) + '...'
        : info.description;
      lines.push(desc);
    }

    lines.push(info.url);

    return lines.join('\n');
  }

  /**
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  /**
   * Parse HTML metadata (title, description, image, favicon)
   */
  private parseHTMLMetadata(html: string): {
    title?: string;
    description?: string;
    image?: string;
    favicon?: string;
  } {
    const result: { title?: string; description?: string; image?: string; favicon?: string } = {};

    // Title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      result.title = this.cleanText(titleMatch[1]);
    }

    // Meta description
    const descMatch = html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
    ) || html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i
    );
    if (descMatch) {
      result.description = this.cleanText(descMatch[1]);
    }

    // Open Graph image
    const ogImageMatch = html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
    ) || html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i
    );
    if (ogImageMatch) {
      result.image = ogImageMatch[1];
    }

    // Favicon
    const faviconMatch = html.match(
      /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i
    ) || html.match(
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i
    );
    if (faviconMatch) {
      result.favicon = faviconMatch[1];
    }

    return result;
  }

  /**
   * Clean text content (decode entities, trim)
   */
  private cleanText(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Resolve relative URL against base
   */
  private resolveUrl(base: string, relative?: string): string | undefined {
    if (!relative) return undefined;
    try {
      return new URL(relative, base).href;
    } catch {
      return relative;
    }
  }

  /**
   * Cache link info
   */
  private cacheLink(url: string, info: LinkInfo): void {
    this.cache.set(url, info);
    this.cacheTimestamps.set(url, Date.now());

    // Cleanup old cache entries
    if (this.cache.size > 100) {
      const now = Date.now();
      for (const [key, timestamp] of this.cacheTimestamps) {
        if (now - timestamp > this.cacheMaxAge) {
          this.cache.delete(key);
          this.cacheTimestamps.delete(key);
        }
      }
    }
  }
}
