import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { Worker } from '@temporalio/worker';
import { expect, it } from 'vitest';

import { createTaskQueue, withTimeSkippingEnv } from '../../test/temporal';
import { type CrawlerWorkflowOutput, crawlerWorkflow } from './crawler_workflow';

it('should discover multiple pages across business domains', async () => {
  await withTimeSkippingEnv(async (env) => {
    const taskQueue = createTaskQueue('test-crawler');
    const worker = await Worker.create({
      connection: env.nativeConnection,
      workflowsPath: path.resolve(__dirname, 'crawler_workflow.ts'),
      taskQueue,
      activities: {
        async parseLinksFromUrl(input: { url: string }): Promise<{ links: string[] }> {
          const url = input.url.replace(/\/$/, '');

          if (url === 'https://business-site.com') {
            return {
              links: [
                'https://business-site.com/products',
                'https://business-site.com/services',
                'https://partner-site.com/collaboration',
              ],
            };
          }

          if (url === 'https://business-site.com/products') {
            return {
              links: [
                'https://business-site.com/product-catalog',
                'https://business-site.com/pricing',
              ],
            };
          }

          if (url === 'https://business-site.com/services') {
            return {
              links: [
                'https://business-site.com/consulting',
                'https://external-partner.com/integration',
              ],
            };
          }

          return { links: [] };
        },
      },
    });

    await worker.runUntil(async () => {
      const result = await env.client.workflow.execute(crawlerWorkflow, {
        args: [
          {
            startUrl: 'https://business-site.com',
            maxLinks: 5,
          },
        ],
        taskQueue,
        workflowId: `test-interconnected-crawl-${randomUUID()}`,
      });

      expect(result.totalLinksCrawled).toBeLessThanOrEqual(5);
      expect(result.linksDiscovered).toEqual(
        expect.arrayContaining([
          'https://business-site.com/products',
          'https://business-site.com/services',
          'https://partner-site.com/collaboration',
        ]),
      );
      expect(result.domainsDiscovered).toEqual(
        expect.arrayContaining(['business-site.com', 'partner-site.com']),
      );
    });
  });
});

it('should respect user-defined crawl limits', async () => {
  await withTimeSkippingEnv(async (env) => {
    const taskQueue = createTaskQueue('test-crawler-limit');
    const worker = await Worker.create({
      connection: env.nativeConnection,
      workflowsPath: path.resolve(__dirname, 'crawler_workflow.ts'),
      taskQueue,
      activities: {
        async parseLinksFromUrl(input: { url: string }): Promise<{ links: string[] }> {
          if (input.url.replace(/\/$/, '') === 'https://company-site.com') {
            return {
              links: ['https://company-site.com/about', 'https://company-site.com/contact'],
            };
          }

          return { links: [] };
        },
      },
    });

    await worker.runUntil(async () => {
      const result = await env.client.workflow.execute(crawlerWorkflow, {
        args: [
          {
            startUrl: 'https://company-site.com',
            maxLinks: 1,
          },
        ],
        taskQueue,
        workflowId: `test-limited-crawl-${randomUUID()}`,
      });

      expect(result.totalLinksCrawled).toBe(1);
      expect(result.linksDiscovered).toEqual(
        expect.arrayContaining([
          'https://company-site.com/about',
          'https://company-site.com/contact',
        ]),
      );
      expect(result.domainsDiscovered).toEqual(['company-site.com']);
    });
  });
});

it('should handle websites with no outbound links', async () => {
  await withTimeSkippingEnv(async (env) => {
    const taskQueue = createTaskQueue('test-crawler-empty');
    const worker = await Worker.create({
      connection: env.nativeConnection,
      workflowsPath: path.resolve(__dirname, 'crawler_workflow.ts'),
      taskQueue,
      activities: {
        async parseLinksFromUrl(): Promise<{ links: string[] }> {
          return { links: [] };
        },
      },
    });

    await worker.runUntil(async () => {
      const result = await env.client.workflow.execute(crawlerWorkflow, {
        args: [
          {
            startUrl: 'https://simple-landing-page.com',
            maxLinks: 10,
          },
        ],
        taskQueue,
        workflowId: `test-empty-site-${randomUUID()}`,
      });

      expect(result).toEqual<CrawlerWorkflowOutput>({
        totalLinksCrawled: 1,
        linksDiscovered: [],
        domainsDiscovered: [],
      });
    });
  });
});

it('should eliminate duplicate discoveries on circular sites', async () => {
  await withTimeSkippingEnv(async (env) => {
    const taskQueue = createTaskQueue('test-crawler-circular');
    const worker = await Worker.create({
      connection: env.nativeConnection,
      workflowsPath: path.resolve(__dirname, 'crawler_workflow.ts'),
      taskQueue,
      activities: {
        async parseLinksFromUrl(input: { url: string }): Promise<{ links: string[] }> {
          const url = input.url.replace(/\/$/, '');

          if (url === 'https://circular-site.com') {
            return {
              links: [
                'https://circular-site.com/page1',
                'https://circular-site.com/page1',
                'https://circular-site.com/page2',
              ],
            };
          }

          if (url === 'https://circular-site.com/page1') {
            return {
              links: ['https://circular-site.com/page2', 'https://circular-site.com/page3'],
            };
          }

          return { links: [] };
        },
      },
    });

    await worker.runUntil(async () => {
      const result = await env.client.workflow.execute(crawlerWorkflow, {
        args: [
          {
            startUrl: 'https://circular-site.com',
            maxLinks: 3,
          },
        ],
        taskQueue,
        workflowId: `test-circular-crawl-${randomUUID()}`,
      });

      expect(new Set(result.linksDiscovered).size).toBe(result.linksDiscovered.length);
      expect(result.linksDiscovered).toEqual(
        expect.arrayContaining([
          'https://circular-site.com/page1',
          'https://circular-site.com/page2',
        ]),
      );
    });
  });
});
