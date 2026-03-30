import { executeChild, log, proxyActivities, sleep, workflowInfo } from '@temporalio/workflow';

import type * as loadGeneratorActivities from './load_generator_activities';

export const LOAD_GENERATOR_TASK_QUEUE = 'load-generator-task-queue';
export const MAX_CONCURRENT_ACTIVITIES = 2_000;

export interface GenerateLoadWorkflowInput {
  activityPerSecond?: number;
}

export interface RunActivityWorkflowInput {
  numberOfActivities: number;
}

export interface RunActivityWorkflowOutput {
  totalActivitiesExecuted: number;
}

const { noopActivity } = proxyActivities<typeof loadGeneratorActivities>({
  startToCloseTimeout: '1 second',
  retry: {
    initialInterval: '1 second',
    maximumInterval: '1 second',
  },
});

function assertPositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }
}

function createActivityBatches(activityPerSecond: number): number[] {
  const batches: number[] = [];
  let remainingActivities = activityPerSecond;

  while (remainingActivities > 0) {
    const batchSize = Math.min(remainingActivities, MAX_CONCURRENT_ACTIVITIES);
    batches.push(batchSize);
    remainingActivities -= batchSize;
  }

  return batches;
}

export async function generateLoadWorkflow(input: GenerateLoadWorkflowInput): Promise<void> {
  const activityPerSecond = input.activityPerSecond ?? 1;
  let iteration = 0;

  assertPositiveInteger(activityPerSecond, 'activityPerSecond');

  log.info('Starting load generator', { activityPerSecond });

  while (true) {
    const batches = createActivityBatches(activityPerSecond);

    await Promise.all(
      batches.map(async (numberOfActivities, index) =>
        executeChild(runActivityWorkflow, {
          args: [{ numberOfActivities }],
          workflowId: `${workflowInfo().workflowId}-child-${iteration}-${index}`,
        }),
      ),
    );

    iteration += 1;
    await sleep('1 second');
  }
}

export async function runActivityWorkflow(
  input: RunActivityWorkflowInput,
): Promise<RunActivityWorkflowOutput> {
  assertPositiveInteger(input.numberOfActivities, 'numberOfActivities');

  log.info('Starting run activity workflow', {
    numberOfActivities: input.numberOfActivities,
  });

  const results = await Promise.all(
    Array.from({ length: input.numberOfActivities }, async () => noopActivity({ message: 'ping' })),
  );

  return {
    totalActivitiesExecuted: results.length,
  };
}
