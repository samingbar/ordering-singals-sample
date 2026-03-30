# Write A New Workflow

## Checklist

1. Create a new folder under `src/workflows/`.
2. Add an activity module for side effects.
3. Add a workflow module that uses `proxyActivities`.
4. Add a `worker.ts` file.
5. Add a `run.ts` file.
6. Add `*.test.ts` files for activities and workflow behavior.

## Naming Convention

- Keep workflow folders under `src/workflows/<name>/`
- Use `*_activities.ts` and `*_workflow.ts`
- Use `*.test.ts` for tests

## Best Practices

- Keep workflow code deterministic.
- Put HTTP, file I/O, and external service calls in activities.
- Use plain objects for workflow and activity payloads.
- Use explicit activity timeouts with `proxyActivities`.
- Prefer behavioral tests over implementation-heavy tests.

## Example

```ts
import { log, proxyActivities } from '@temporalio/workflow';

import type * as activities from './example_activities';

export interface ExampleWorkflowInput {
  name: string;
}

export interface ExampleWorkflowOutput {
  greeting: string;
}

const { formatGreeting } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds'
});

export async function exampleWorkflow(
  input: ExampleWorkflowInput
): Promise<ExampleWorkflowOutput> {
  log.info('Starting example workflow', { name: input.name });

  const greeting = await formatGreeting({ name: input.name });

  return { greeting };
}
```

## Run Script Example

```ts
import { randomUUID } from 'node:crypto';

import { createClient } from '../../shared/temporal';
import { exampleWorkflow } from './example_workflow';

async function main(): Promise<void> {
  const client = await createClient();

  const result = await client.workflow.execute(exampleWorkflow, {
    args: [{ name: 'Temporal' }],
    taskQueue: 'example-task-queue',
    workflowId: `example-${randomUUID()}`
  });

  console.log(result);
}

void main();
```
