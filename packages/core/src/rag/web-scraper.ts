import { Logger } from 'pino';
import { getLogger } from '../utils/logger.js';
import { HTTPClient, HTTPConfig } from '../utils/http-client.js';

export interface ScraperConfig {
  /** HTTP client config */
  http?: Partial<HTTPConfig>;
  /** Max pages to scrape per session */
  maxPages?: number;
  /** Delay between requests in ms */
  delayMs?: number;
}

export interface ScrapedContent {
  url: string;
  title: string;
  description: string;
  content: string;
  links: string[];
  images: string[];
  metadata: Record<string, string>;
}

/**
 * WebScraper fetches and parses web pages for content extraction.
 * Uses HTTPClient for domain whitelist and SSRF protection.
 */
export class WebScraper {
  private logger: Logger;
  private httpClient: HTTPClient;
  private config: ScraperConfig;
  private scrapedUrls: Set<string> = new Set();

  constructor(config: ScraperConfig = {}) {
    this.logger = getLogger().child({ module: 'web-scraper' });
    this.config = config;
    this.httpClient = new HTTPClient(config.http);
  }

  /**
   * Scrape a single URL
   */
  async scrape(url: string): Promise<ScrapedContent | null> {
    // Check if already scraped
    if (this.scrapedUrls.has(url)) {
      this.logger.debug({ url }, 'Already scraped');
      return null;
    }

    // Check max pages
    if (this.config.maxPages && this.scrapedUrls.size >= this.config.maxPages) {
      this.logger.warn({ maxPages: this.config.maxPages }, 'Max pages reached');
      return null;
    }

    // Delay between requests
    if (this.config.delayMs && this.scrapedUrls.size > 0) {
      await new Promise((r) => setTimeout(r, this.config.delayMs));
    }

    const response = await this.httpClient.get(url);

    if (!response.ok) {
      this.logger.warn({ url, status: response.status }, 'Failed to fetch URL');
      return null;
    }

    this.scrapedUrls.add(url);

    const content = this.parseHTML(response.body, url);

    this.logger.info({ url, title: content.title }, 'URL scraped');

    return content;
  }

  /**
   * Scrape multiple URLs
   */
  async scrapeAll(urls: string[]): Promise<ScrapedContent[]> {
    const results: ScrapedContent[] = [];

    for (const url of urls) {
      const content = await this.scrape(url);
      if (content) {
        results.push(content);
      }
    }

    return results;
  }

  /**
   * Search and scrape results from DuckDuckGo HTML
   */
  async search(query: string, limit = 5): Promise<ScrapedContent[]> {
    this.logger.info({ query, limit }, 'Searching DuckDuckGo');

    try {
      // Search DuckDuckGo HTML version
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const searchResponse = await this.httpClient.get(searchUrl);

      if (!searchResponse.ok) {
        this.logger.warn({ status: searchResponse.status }, 'Search request failed');
        return [];
      }

      // Extract result URLs from DuckDuckGo HTML
      const urls = this.extractSearchUrls(searchResponse.body);

      if (urls.length === 0) {
        this.logger.info('No search results found');
        return [];
      }

      // Scrape top results
      const results: ScrapedContent[] = [];
      for (const url of urls.slice(0, limit)) {
        const content = await this.scrape(url);
        if (content) {
          results.push(content);
        }
      }

      this.logger.info({ query, results: results.length }, 'Search completed');
      return results;
    } catch (err: any) {
      this.logger.warn({ error: err.message, query }, 'Search failed');
      return [];
    }
  }

  /**
   * Extract URLs from DuckDuckGo HTML search results
   */
  private extractSearchUrls(html: string): string[] {
    const urls: string[] = [];
    // DuckDuckGo result links are in <a class="result__a" href="...">
    const regex = /class="result__a"[^>]*href="([^"]+)"/gi;
    let match;

    while ((match = regex.exec(html)) !== null) {
      const href = match[1];
      // DuckDuckGo wraps URLs in redirect URLs, extract the actual URL
      const urlMatch = href.match(/uddg=([^&]+)/);
      if (urlMatch) {
        const decoded = decodeURIComponent(urlMatch[1]);
        if (!urls.includes(decoded)) {
          urls.push(decoded);
        }
      } else if (href.startsWith('http') && !urls.includes(href)) {
        urls.push(href);
      }
    }

    return urls.slice(0, 20); // Limit to 20 results
  }

  /**
   * Parse HTML content
   */
  private parseHTML(html: string, url: string): ScrapedContent {
    const title = this.extractTag(html, 'title') || '';
    const description = this.extractMeta(html, 'description') || '';
    const content = this.extractText(html);
    const links = this.extractLinks(html, url);
    const images = this.extractImages(html, url);
    const metadata = this.extractMetadata(html);

    return {
      url,
      title,
      description,
      content: content.slice(0, 50000), // Limit content size
      links,
      images,
      metadata,
    };
  }

  /**
   * Extract text content from HTML
   */
  private extractText(html: string): string {
    // Remove scripts and styles
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ');

    // Decode entities
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }

  /**
   * Extract specific tag content
   */
  private extractTag(html: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
    const match = html.match(regex);
    return match ? match[1].trim() : null;
  }

  /**
   * Extract meta tag content
   */
  private extractMeta(html: string, name: string): string | null {
    const patterns = [
      new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'),
      new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Extract links from HTML
   */
  private extractLinks(html: string, baseUrl: string): string[] {
    const links: string[] = [];
    const linkRegex = /href=["']([^"']+)["']/gi;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];

      // Skip anchors and javascript
      if (href.startsWith('#') || href.startsWith('javascript:')) {
        continue;
      }

      // Resolve relative URLs
      try {
        const resolved = new URL(href, baseUrl).href;
        if (!links.includes(resolved)) {
          links.push(resolved);
        }
      } catch {
        // Invalid URL, skip
      }
    }

    return links.slice(0, 100); // Limit links
  }

  /**
   * Extract images from HTML
   */
  private extractImages(html: string, baseUrl: string): string[] {
    const images: string[] = [];
    const imgRegex = /src=["']([^"']+)["']/gi;
    let match;

    while ((match = imgRegex.exec(html)) !== null) {
      const src = match[1];

      // Skip data URLs
      if (src.startsWith('data:')) {
        continue;
      }

      // Resolve relative URLs
      try {
        const resolved = new URL(src, baseUrl).href;
        if (!images.includes(resolved)) {
          images.push(resolved);
        }
      } catch {
        // Invalid URL, skip
      }
    }

    return images.slice(0, 50); // Limit images
  }

  /**
   * Extract metadata from HTML
   */
  private extractMetadata(html: string): Record<string, string> {
    const metadata: Record<string, string> = {};

    // Open Graph tags
    const ogTags = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'];
    for (const tag of ogTags) {
      const value = this.extractMeta(html, tag);
      if (value) {
        metadata[tag] = value;
      }
    }

    // Twitter tags
    const twitterTags = ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image'];
    for (const tag of twitterTags) {
      const value = this.extractMeta(html, tag);
      if (value) {
        metadata[tag] = value;
      }
    }

    return metadata;
  }

  /**
   * Clear scraped URLs cache
   */
  clearCache(): void {
    this.scrapedUrls.clear();
  }
}
