import { randomUUID } from 'node:crypto';

import { createClient } from '../../shared/temporal';
import { LOAD_GENERATOR_TASK_QUEUE, generateLoadWorkflow } from './load_generator_workflow';

export async function runLoadGeneratorWorkflow(): Promise<void> {
  const client = await createClient();
  const handle = await client.workflow.start(generateLoadWorkflow, {
    args: [{ activityPerSecond: 1 }],
    taskQueue: LOAD_GENERATOR_TASK_QUEUE,
    workflowId: `load-generator-${randomUUID()}`,
  });

  console.log(`Load generator workflow started: ${handle.workflowId}`);
}

if (require.main === module) {
  runLoadGeneratorWorkflow().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
