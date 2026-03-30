import path from 'node:path';

import { Worker } from '@temporalio/worker';

import { createWorkerConnection } from '../../shared/temporal';
import * as activities from './load_generator_activities';
import { LOAD_GENERATOR_TASK_QUEUE } from './load_generator_workflow';

export async function runWorker(): Promise<void> {
  const worker = await Worker.create({
    connection: await createWorkerConnection(),
    workflowsPath: path.resolve(__dirname, 'load_generator_workflow.ts'),
    activities,
    taskQueue: LOAD_GENERATOR_TASK_QUEUE,
  });

  await worker.run();
}

if (require.main === module) {
  runWorker().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
