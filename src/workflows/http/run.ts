import { randomUUID } from 'node:crypto';

import { createClient } from '../../shared/temporal';
import { HTTP_TASK_QUEUE, type HttpWorkflowInput, httpWorkflow } from './http_workflow';

export async function runHttpWorkflow(): Promise<void> {
  const client = await createClient();
  const input: HttpWorkflowInput = {
    url: 'https://httpbin.org/anything/http-workflow',
  };

  const result = await client.workflow.execute(httpWorkflow, {
    args: [input],
    taskQueue: HTTP_TASK_QUEUE,
    workflowId: `http-workflow-${randomUUID()}`,
  });

  console.log('HTTP workflow result:', result);
}

if (require.main === module) {
  runHttpWorkflow().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
