import { randomUUID } from 'node:crypto';

import { TestWorkflowEnvironment } from '@temporalio/testing';

export function createTaskQueue(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export async function withLocalEnv(
  run: (env: TestWorkflowEnvironment) => Promise<void>,
): Promise<void> {
  const env = await TestWorkflowEnvironment.createLocal();

  try {
    await run(env);
  } finally {
    await env.teardown();
  }
}

export async function withTimeSkippingEnv(
  run: (env: TestWorkflowEnvironment) => Promise<void>,
): Promise<void> {
  const env = await TestWorkflowEnvironment.createTimeSkipping();

  try {
    await run(env);
  } finally {
    await env.teardown();
  }
}
