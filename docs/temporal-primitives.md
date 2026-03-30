# Temporal Primitives

## Workflow

Workflows coordinate execution and must remain deterministic.

```ts
import { proxyActivities } from '@temporalio/workflow';

import type * as activities from './activities';

const { sendEmail } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute'
});

export async function welcomeWorkflow(input: { email: string }): Promise<void> {
  await sendEmail(input);
}
```

## Activity

Activities handle side effects.

```ts
export async function sendEmail(input: { email: string }): Promise<void> {
  await fetch('https://example.com/email', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}
```

## Timer

Use `sleep` inside workflows.

```ts
import { sleep } from '@temporalio/workflow';

export async function reminderWorkflow(): Promise<void> {
  await sleep('5 minutes');
}
```

## Signal

Signals let clients push asynchronous updates into a running workflow.

```ts
import { condition, defineSignal, setHandler } from '@temporalio/workflow';

const approveSignal = defineSignal<[string]>('approve');

export async function approvalWorkflow(): Promise<string[]> {
  const approvals: string[] = [];

  setHandler(approveSignal, (name) => {
    approvals.push(name);
  });

  await condition(() => approvals.length > 0);
  return approvals;
}
```

## Query

Queries expose current workflow state.

```ts
import { defineQuery, setHandler } from '@temporalio/workflow';

const countQuery = defineQuery<number>('count');

export async function counterWorkflow(): Promise<void> {
  let count = 0;

  setHandler(countQuery, () => count);
  count += 1;
}
```

## Update

Updates synchronously change workflow state and can return values.

```ts
import { defineUpdate, setHandler } from '@temporalio/workflow';

const setPriority = defineUpdate<number, [number]>('setPriority');

export async function queueWorkflow(): Promise<void> {
  let priority = 0;

  setHandler(setPriority, (nextPriority) => {
    const previous = priority;
    priority = nextPriority;
    return previous;
  });
}
```

## Child Workflow

Use child workflows when orchestration needs its own execution history.

```ts
import { executeChild } from '@temporalio/workflow';

export async function parentWorkflow(): Promise<void> {
  await executeChild(childWorkflow, {
    args: [{ size: 10 }],
    workflowId: 'child-1'
  });
}

export async function childWorkflow(input: { size: number }): Promise<void> {
  console.log(input.size);
}
```

## Retry

Configure activity retries when using `proxyActivities`.

```ts
const { chargeCard } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    maximumAttempts: 5
  }
});
```
