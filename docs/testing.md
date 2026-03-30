# Testing Standards

This repository uses **Vitest** and Temporal's TypeScript test environment.

## Test Types

### Activity Tests

Use direct unit tests for activities when possible:

- mock `fetch`
- spy on helper functions
- assert returned payloads

### Workflow Tests

Use `TestWorkflowEnvironment` for workflow behavior:

- `createTimeSkipping()` for orchestration with timers
- `createLocal()` when real waiting is acceptable

Register mocked activities through the worker so the workflow test stays focused on orchestration.

## Guidelines

1. Name tests by behavior, not implementation detail.
2. Keep external services mocked.
3. Assert workflow outputs and orchestration decisions.
4. Prefer one task queue per test.
5. Tear down the Temporal test environment after each scenario.

## Example Workflow Test

```ts
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { Worker } from '@temporalio/worker';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { expect, test } from 'vitest';

import { exampleWorkflow } from './example_workflow';

test('should orchestrate the activity result', async () => {
  const env = await TestWorkflowEnvironment.createTimeSkipping();

  try {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      workflowsPath: path.resolve(__dirname, 'example_workflow.ts'),
      taskQueue: 'example-task-queue',
      activities: {
        async formatGreeting(): Promise<{ greeting: string }> {
          return { greeting: 'Hello, Temporal' };
        }
      }
    });

    await worker.runUntil(async () => {
      const result = await env.client.workflow.execute(exampleWorkflow, {
        args: [{ name: 'Temporal' }],
        taskQueue: 'example-task-queue',
        workflowId: `example-${randomUUID()}`
      });

      expect(result).toEqual({ greeting: 'Hello, Temporal' });
    });
  } finally {
    await env.teardown();
  }
});
```
