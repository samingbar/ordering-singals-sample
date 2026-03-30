# Temporal Patterns

## Activity Boundary

Keep workflows deterministic and move side effects into activities.

```ts
import { proxyActivities } from '@temporalio/workflow';

import type * as activities from './activities';

const { loadAccount } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds'
});

export async function accountWorkflow(input: { id: string }) {
  return loadAccount(input);
}
```

## Fan-Out / Fan-In

Use `Promise.all` in workflows to fan out activity or child workflow execution and then collect results.

```ts
const { fetchPage } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds'
});

export async function batchWorkflow(input: { urls: string[] }) {
  return Promise.all(input.urls.map(async (url) => fetchPage({ url })));
}
```

## Child Workflow Batching

When a single workflow would create too much concurrent work, split it into child workflows.

```ts
import { executeChild } from '@temporalio/workflow';

export async function parentWorkflow(input: { batches: number[] }) {
  await Promise.all(
    input.batches.map(async (batch, index) =>
      executeChild(childWorkflow, {
        args: [{ count: batch }],
        workflowId: `child-${index}`
      })
    )
  );
}
```

## Signal-Driven Workflows

Use signals when execution should wait for external events.

```ts
import { condition, defineSignal, setHandler } from '@temporalio/workflow';

const addItem = defineSignal<[string]>('addItem');

export async function inboxWorkflow(): Promise<string[]> {
  const items: string[] = [];

  setHandler(addItem, (item) => {
    items.push(item);
  });

  await condition(() => items.length >= 3);
  return items;
}
```

## Long-Running Workflows

For workflows that run indefinitely, add a continue-as-new strategy before production use. The `load_generator` sample intentionally stays simple so the orchestration logic is easy to read.

## Mocked Workflow Testing

Register mocked activities in the worker and run the real workflow code against the Temporal test environment. This keeps tests focused on orchestration instead of network behavior.
