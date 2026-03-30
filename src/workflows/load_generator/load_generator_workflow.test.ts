import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { Worker } from '@temporalio/worker';
import { expect, it, vi } from 'vitest';

import { createTaskQueue, withTimeSkippingEnv } from '../../test/temporal';
import { generateLoadWorkflow, runActivityWorkflow } from './load_generator_workflow';

it('should execute the requested number of activities in the child workflow', async () => {
  await withTimeSkippingEnv(async (env) => {
    const taskQueue = createTaskQueue('test-run-activity-workflow');
    const worker = await Worker.create({
      connection: env.nativeConnection,
      workflowsPath: path.resolve(__dirname, 'load_generator_workflow.ts'),
      taskQueue,
      activities: {
        async noopActivity(input: { message: string }): Promise<{ message: string }> {
          return { message: `mocked: ${input.message}` };
        },
      },
    });

    await worker.runUntil(async () => {
      const result = await env.client.workflow.execute(runActivityWorkflow, {
        args: [{ numberOfActivities: 5 }],
        taskQueue,
        workflowId: `test-run-activity-${randomUUID()}`,
      });

      expect(result.totalActivitiesExecuted).toBe(5);
    });
  });
});

it('should schedule repeated child workflows until the workflow is cancelled', async () => {
  await withTimeSkippingEnv(async (env) => {
    const taskQueue = createTaskQueue('test-generate-load');
    let activityCounter = 0;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      workflowsPath: path.resolve(__dirname, 'load_generator_workflow.ts'),
      taskQueue,
      activities: {
        async noopActivity(input: { message: string }): Promise<{ message: string }> {
          activityCounter += 1;
          return { message: `mocked: ${input.message}` };
        },
      },
    });

    await worker.runUntil(async () => {
      const handle = await env.client.workflow.start(generateLoadWorkflow, {
        args: [{ activityPerSecond: 1 }],
        taskQueue,
        workflowId: `test-generate-load-${randomUUID()}`,
      });

      await vi.waitFor(
        () => {
          expect(activityCounter).toBeGreaterThan(0);
        },
        { timeout: 5_000, interval: 100 },
      );

      await handle.cancel();
      await expect(handle.result()).rejects.toBeDefined();
    });
  });
});
