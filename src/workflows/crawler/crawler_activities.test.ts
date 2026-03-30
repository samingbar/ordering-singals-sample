import { afterEach, describe, expect, it, vi } from 'vitest';

import * as crawlerActivities from './crawler_activities';

describe('fetchUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should retrieve page content when a valid URL is provided', async () => {
    const websiteUrl = 'https://example.com';
    const expectedPageContent = '<html><body><h1>Welcome to Example</h1></body></html>';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(expectedPageContent, { status: 200 }));

    const result = await crawlerActivities.fetchUrl(websiteUrl);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0].toString()).toBe(new URL(websiteUrl).toString());
    expect(result).toEqual({
      url: new URL(websiteUrl).toString(),
      htmlContent: expectedPageContent,
      success: true,
    });
  });

  it('should handle network failures gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Website unavailable'));

    const result = await crawlerActivities.fetchUrl('https://unavailable-website.com');

    expect(result).toEqual({
      url: 'https://unavailable-website.com/',
      htmlContent: '',
      success: false,
    });
  });
});

describe('parseLinks', () => {
  it('should discover standard and relative links', () => {
    const htmlContent = `
      <html>
        <body>
          <a href="https://example.com/products">Products</a>
          <a href="/contact">Contact</a>
          <a href="team/members">Team</a>
        </body>
      </html>
    `;

    const discoveredLinks = crawlerActivities.parseLinks(
      htmlContent,
      'https://example.com/current/page',
    );

    expect(discoveredLinks).toHaveLength(3);
    expect(discoveredLinks).toContain('https://example.com/products');
    expect(discoveredLinks).toContain('https://example.com/contact');
    expect(discoveredLinks).toContain('https://example.com/current/team/members');
  });

  it('should filter unsupported links and remove duplicates', () => {
    const htmlContent = `
      <html>
        <body>
          <a href="#section1">Section</a>
          <a href="mailto:contact@example.com">Email</a>
          <a href="https://example.com/products">Products</a>
          <a href="/products">Products Duplicate</a>
          <a href="javascript:void(0)">Ignore me</a>
        </body>
      </html>
    `;

    const discoveredLinks = crawlerActivities.parseLinks(htmlContent, 'https://example.com');

    expect(discoveredLinks).toEqual(['https://example.com/products']);
  });

  it('should return an empty list when the page has no links', () => {
    expect(crawlerActivities.parseLinks('', 'https://example.com')).toEqual([]);
  });
});

describe('parseLinksFromUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should parse links from fetched page content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        `
          <html>
            <body>
              <a href="https://example.com/products">Products</a>
              <a href="https://example.com/services">Services</a>
            </body>
          </html>
        `,
        { status: 200 },
      ),
    );

    const result = await crawlerActivities.parseLinksFromUrl({ url: 'https://example.com' });

    expect(result.links).toHaveLength(2);
    expect(result.links).toContain('https://example.com/products');
    expect(result.links).toContain('https://example.com/services');
  });

  it('should return an empty list when the page cannot be fetched', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Website unavailable'));

    await expect(
      crawlerActivities.parseLinksFromUrl({ url: 'https://broken-website.com' }),
    ).resolves.toEqual({ links: [] });
  });
});
