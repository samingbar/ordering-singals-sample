import { log, proxyActivities } from '@temporalio/workflow';

import type * as crawlerActivities from './crawler_activities';

export const CRAWLER_TASK_QUEUE = 'crawler-task-queue';

export interface CrawlerWorkflowInput {
  startUrl: string;
  maxLinks?: number;
}

export interface CrawlerWorkflowOutput {
  totalLinksCrawled: number;
  linksDiscovered: string[];
  domainsDiscovered: string[];
}

const { parseLinksFromUrl } = proxyActivities<typeof crawlerActivities>({
  startToCloseTimeout: '10 seconds',
});

export async function crawlerWorkflow(input: CrawlerWorkflowInput): Promise<CrawlerWorkflowOutput> {
  const maxLinks = input.maxLinks ?? 10;

  log.info('Starting web crawler workflow', {
    maxLinks,
    startUrl: input.startUrl,
  });

  const discoveredLinks = new Set<string>();
  const discoveredDomains = new Set<string>();
  let linksToCrawl = [input.startUrl];
  let totalLinksCrawled = 0;

  while (linksToCrawl.length > 0 && totalLinksCrawled < maxLinks) {
    const remainingCapacity = maxLinks - totalLinksCrawled;
    const currentLinks = linksToCrawl.slice(0, remainingCapacity);
    const results = await Promise.all(
      currentLinks.map(async (link) => parseLinksFromUrl({ url: link })),
    );

    for (const parsedLinks of results) {
      for (const link of parsedLinks.links) {
        if (discoveredLinks.has(link)) {
          continue;
        }

        discoveredLinks.add(link);
        linksToCrawl.push(link);
        discoveredDomains.add(new URL(link).host);
      }
    }

    totalLinksCrawled += currentLinks.length;
    linksToCrawl = linksToCrawl.slice(remainingCapacity);
  }

  return {
    totalLinksCrawled,
    linksDiscovered: Array.from(discoveredLinks).sort(),
    domainsDiscovered: Array.from(discoveredDomains).sort(),
  };
}
