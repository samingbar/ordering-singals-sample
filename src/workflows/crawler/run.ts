import { randomUUID } from 'node:crypto';

import { createClient } from '../../shared/temporal';
import { CRAWLER_TASK_QUEUE, type CrawlerWorkflowInput, crawlerWorkflow } from './crawler_workflow';

export async function runCrawlerWorkflow(): Promise<void> {
  const client = await createClient();
  const input: CrawlerWorkflowInput = {
    startUrl: 'https://httpbin.org/links/10/0',
    maxLinks: 10,
  };

  const result = await client.workflow.execute(crawlerWorkflow, {
    args: [input],
    taskQueue: CRAWLER_TASK_QUEUE,
    workflowId: `crawler-${randomUUID()}`,
  });

  console.log('Crawler workflow result:', result);
}

if (require.main === module) {
  runCrawlerWorkflow().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
