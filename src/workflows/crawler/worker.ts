import path from 'node:path';

import { Worker } from '@temporalio/worker';

import { createWorkerConnection } from '../../shared/temporal';
import * as activities from './crawler_activities';
import { CRAWLER_TASK_QUEUE } from './crawler_workflow';

export async function runWorker(): Promise<void> {
  const worker = await Worker.create({
    connection: await createWorkerConnection(),
    workflowsPath: path.resolve(__dirname, 'crawler_workflow.ts'),
    activities,
    taskQueue: CRAWLER_TASK_QUEUE,
  });

  await worker.run();
}

if (require.main === module) {
  runWorker().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
