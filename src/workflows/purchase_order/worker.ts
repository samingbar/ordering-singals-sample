import path from 'node:path';

import { Worker } from '@temporalio/worker';

import { createWorkerConnection } from '../../shared/temporal';
import * as activities from './purchase_order_activities';
import { PURCHASE_ORDER_TASK_QUEUE } from './purchase_order_workflow';

export async function runWorker(): Promise<void> {
  const worker = await Worker.create({
    connection: await createWorkerConnection(),
    workflowsPath: path.resolve(__dirname, 'purchase_order_workflow.ts'),
    activities,
    taskQueue: PURCHASE_ORDER_TASK_QUEUE,
  });

  await worker.run();
}

if (require.main === module) {
  runWorker().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
