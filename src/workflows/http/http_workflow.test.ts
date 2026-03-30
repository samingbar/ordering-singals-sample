import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { Worker } from '@temporalio/worker';
import { expect, it } from 'vitest';

import { createTaskQueue, withTimeSkippingEnv } from '../../test/temporal';
import { type HttpWorkflowInput, type HttpWorkflowOutput, httpWorkflow } from './http_workflow';

it('should return the mocked HTTP activity response', async () => {
  await withTimeSkippingEnv(async (env) => {
    const taskQueue = createTaskQueue('test-http-workflow');
    const testUrl = 'https://example.com/test';
    const worker = await Worker.create({
      connection: env.nativeConnection,
      workflowsPath: path.resolve(__dirname, 'http_workflow.ts'),
      taskQueue,
      activities: {
        async httpGet(input: HttpWorkflowInput): Promise<HttpWorkflowOutput> {
          return {
            responseText: `Mocked response for ${input.url}`,
            url: input.url,
            statusCode: 200,
          };
        },
      },
    });

    await worker.runUntil(async () => {
      const result = await env.client.workflow.execute(httpWorkflow, {
        args: [{ url: testUrl }],
        taskQueue,
        workflowId: `test-http-workflow-${randomUUID()}`,
      });

      expect(result).toEqual({
        responseText: `Mocked response for ${testUrl}`,
        url: testUrl,
        statusCode: 200,
      });
    });
  });
});
