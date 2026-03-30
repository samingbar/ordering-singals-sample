import { Context } from '@temporalio/activity';

export interface HttpGetActivityInput {
  url: string;
}

export interface HttpGetActivityOutput {
  responseText: string;
  statusCode: number;
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

export async function httpGet(input: HttpGetActivityInput): Promise<HttpGetActivityOutput> {
  const logger = getLogger();
  const url = parseHttpUrl(input.url);

  logger.info('Activity: making HTTP GET call', { url: url.toString() });

  const response = await fetch(url, { method: 'GET' });
  const responseText = await response.text();

  return {
    responseText,
    statusCode: response.status,
  };
}
