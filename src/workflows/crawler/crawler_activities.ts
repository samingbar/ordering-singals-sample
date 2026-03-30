import { Context } from '@temporalio/activity';

export interface UrlContent {
  url: string;
  htmlContent: string;
  success: boolean;
}

export interface ParseLinksFromUrlInput {
  url: string;
}

export interface ParseLinksFromUrlOutput {
  links: string[];
}

function getLogger(): Pick<Console, 'error' | 'info'> {
  try {
    return Context.current().log;
  } catch {
    return console;
  }
}

function parseHttpUrl(url: string): URL {
  const parsedUrl = new URL(url);

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new TypeError(`Only HTTP and HTTPS URLs are supported: ${url}`);
  }

  return parsedUrl;
}

export async function fetchUrl(url: string): Promise<UrlContent> {
  const logger = getLogger();
  const parsedUrl = parseHttpUrl(url);

  logger.info('Fetching URL', { url: parsedUrl.toString() });

  try {
    const response = await fetch(parsedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TemporalCrawler/1.0)' },
    });
    const htmlContent = await response.text();

    logger.info('Fetched URL content', {
      url: parsedUrl.toString(),
      bytes: htmlContent.length,
      statusCode: response.status,
    });

    return {
      url: parsedUrl.toString(),
      htmlContent,
      success: response.ok,
    };
  } catch (error) {
    logger.error('Failed to fetch URL', { url: parsedUrl.toString(), error });

    return {
      url: parsedUrl.toString(),
      htmlContent: '',
      success: false,
    };
  }
}

export function parseLinks(htmlContent: string, baseUrl: string): string[] {
  const logger = getLogger();
  const normalizedBaseUrl = parseHttpUrl(baseUrl);
  const hrefPattern = /<a[^>]+href\s*=\s*["']?([^"'>\s]+)["']?[^>]*>/gi;
  const absoluteLinks = new Set<string>();

  logger.info('Parsing links from HTML content', { baseUrl: normalizedBaseUrl.toString() });

  for (const match of htmlContent.matchAll(hrefPattern)) {
    const rawLink = match[1]?.trim() ?? '';

    if (rawLink.length === 0 || rawLink.startsWith('#')) {
      continue;
    }

    try {
      const absoluteUrl = new URL(rawLink, normalizedBaseUrl);

      if (absoluteUrl.protocol === 'http:' || absoluteUrl.protocol === 'https:') {
        absoluteLinks.add(absoluteUrl.toString());
      }
    } catch {}
  }

  return Array.from(absoluteLinks);
}

export async function parseLinksFromUrl(
  input: ParseLinksFromUrlInput,
): Promise<ParseLinksFromUrlOutput> {
  const content = await fetchUrl(input.url);

  if (!content.success) {
    return { links: [] };
  }

  return {
    links: parseLinks(content.htmlContent, input.url),
  };
}
