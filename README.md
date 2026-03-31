# Temporal TypeScript SDK Project Template

This repository is a starter template for building Temporal applications with the **Temporal TypeScript SDK**. It includes three focused SDK samples plus a larger offline-ordering demo, along with integration tests, worker entrypoints, and a minimal TypeScript toolchain built around `npm`, `Vitest`, and `Biome`.

## What's Included

- `http`: a workflow that delegates an HTTP request to an activity
- `crawler`: a workflow that discovers links across multiple pages
- `load_generator`: a workflow that repeatedly launches child workflows to create load
- `purchase_order`: a long-running workflow demo for offline-heavy vendor ordering with signals, queries, timers, and a projection-driven UI
- Workflow integration tests using Temporal's test environment
- Formatting and linting with Biome

## Prerequisites

- Node.js 22+
- npm
- Temporal CLI

## Quick Start

```bash
npm install
npm run build
npm test
temporal server start-dev
```

Run a worker in one terminal:

```bash
npm run worker:http
```

Execute the sample from another terminal:

```bash
npm run workflow:http
```

You can do the same for the other samples:

```bash
npm run worker:crawler
npm run workflow:crawler

npm run worker:load-generator
npm run workflow:load-generator
```

Run the offline-ordering demo against a local Temporal dev server:

```bash
temporal server start-dev
npm run demo
```

Then open:

- `http://localhost:4000` for the ByteInventory internal UI
- `http://localhost:4001` for the vendor simulator

## Project Layout

```text
src/
├── apps/
│   ├── api/
│   └── vendor_sim/
├── shared/
│   └── offline_ordering/
├── test/
└── workflows/
    ├── http/
    ├── crawler/
    ├── load_generator/
    └── purchase_order/
```

## Why This Example Uses Temporal

This purchase-order demo is intentionally more than CRUD over an order table. It models a process that is:

- long-running
- event-driven
- partly offline
- tolerant of duplicate and out-of-order updates
- dependent on durable timers and retries
- driven by both internal users and external vendor callbacks

You do **not** need Temporal to build a system like this. A team could implement the same business flow with application services, a database, background jobs, and idempotency tables. Temporal is useful here because the orchestration problem is the hard part: keep one durable process open for a long time, accept updates at any time, retry external work, and wait safely on timers without building all of that infrastructure yourself.

Temporal helps with:

- durable waiting for vendor/user events
- retries around outbound work
- signals for inbound updates
- queries for live reads
- a durable orchestration history

Temporal does **not** remove the need for:

- good domain modeling
- idempotency keys
- validation of external input
- UI-facing read models
- integration code for vendor and internal systems

## Workflow Vs Activities

The purchase-order example is structured so the workflow owns **state and decisions**, and activities own **external effects**.

The workflow is responsible for:

- holding the current order snapshot
- deduplicating inbound events by `eventId`
- accepting out-of-order events when valid
- deriving the current status
- scheduling and resolving exception timers
- deciding when the workflow is terminal

The activities are responsible for:

- sending the order to the vendor
- publishing a current projection for the UI
- writing an audit stream
- emitting exception notifications

This is why operations like `sendOrderToVendor` are activities even though people often describe them as “side effects.” In Temporal terms, the workflow stays deterministic and the activities perform the external work.

## Why The Demo Writes Projections Outside Temporal

Temporal already persists workflow history. The extra writes in this demo are **not** required for Temporal durability. They exist so the sample has a simple application-facing read model.

The demo writes:

- `data/orders/<orderId>.json` as the latest order projection
- `data/audit-log.jsonl` as an application-level audit stream
- `data/notifications.jsonl` as a stand-in for alert delivery
- `data/vendor-orders/<orderId>.json` as vendor-simulator state

Those files are a convenience layer for the UI and simulator. In a production build, that same seam could be backed by Postgres, Redis, Elasticsearch, Kafka consumers, or another projection pipeline. Temporal remains the orchestration source of truth; the projection layer exists to make reads and integrations straightforward.

## Purchase Order Timer Logic

The purchase-order demo uses timers for **operational visibility**, not for hard workflow failure.

- After `ORDER_SUBMITTED`, the workflow starts an acknowledgment timer. If no `ACKNOWLEDGED` event arrives within 1 day, the workflow records an `EXCEPTION_NOTED` event and raises an alert.
- After `CONFIRMED`, the workflow starts an ASN timer. If no `ASN_RECEIVED` event arrives within 7 days, it records another exception instead of failing the order.
- After `MARKED_RECEIVED`, the workflow starts an invoice timer. If no `INVOICE_RECEIVED` event arrives within 7 days, it records an invoice exception.

When a timer fires, the workflow stays open. It writes the exception to the order timeline, publishes an updated projection for the UI, and sends a notification hook. Later business events can clear those exceptions. For example, a late `ACKNOWLEDGED` event resolves the acknowledgment timeout rather than causing a workflow restart or compensation flow.

## Purchase Order State Logic

This demo does **not** use a rigid linear state machine. Instead, it stores normalized events and derives the current order status from the accumulated facts.

The workflow handles events this way:

1. Each inbound event is checked for `orderId` match and deduplicated by `eventId`.
2. Duplicate events are ignored safely.
3. Out-of-order events are accepted when possible and stored with warnings on the timeline. For example, an invoice can arrive before receipt.
4. Every accepted event updates the snapshot booleans such as `acknowledged`, `confirmed`, `asnReceived`, `markedReceived`, `invoiceReceived`, `creditPosted`, `reconciled`, and `canceled`.
5. The current status is then derived by priority, not by the latest event alone.

Base status priority is:

- `CANCELED` if the order was canceled
- `COMPLETED` if it was reconciled
- `RECONCILING` if an invoice exists and the order has either been received or credited
- `INVOICED` if an invoice exists but reconciliation is not done
- `RECEIVED` if a user marked it received
- `IN_TRANSIT` if an ASN was received
- `CONFIRMED` if the vendor confirmed it
- `ACKNOWLEDGED` if the vendor acknowledged it
- `SUBMITTED` after successful outbound submission
- `CREATED` before submission

`EXCEPTION` is an overlay state. If the order is not terminal and there are open timer exceptions, the UI status becomes `EXCEPTION` even though the underlying base status is still preserved. Terminal states win over the exception overlay, so `CANCELED` and `COMPLETED` remain terminal.

The practical consequence is that most intermediate milestones are optional. `ACKNOWLEDGED`, `CONFIRMED`, `ASN_RECEIVED`, `MARKED_RECEIVED`, `INVOICE_RECEIVED`, and `CREDIT_POSTED` all influence status and alerts, but they are not mandatory for workflow survival. The only terminal outcomes in this demo are `CANCELED` and `RECONCILED`.

## Extending This Pattern

This pattern is meant to be extended.

If a Yum team wanted to add internal ordering steps later, the recommended shape is:

- keep the workflow responsible for state transitions and decisions
- derive internal follow-up actions from accepted events
- run those follow-up actions as activities after the state update, not inline inside signal handlers
- use child workflows for any long-running human or multi-step subprocess

Examples of future internal activities could include:

- open a buyer review task
- reserve internal inventory
- create an ERP receipt
- open an AP matching task
- trigger downstream replenishment or menu-planning workflows

If a real production order can stay open for a very long time or accumulate a very large event history, add `continueAsNew` later. It is not necessary for this demo, but it is the normal next step when turning a pattern like this into a high-volume production workflow.

## Useful Commands

```bash
npm run build
npm test
npm run lint
npm run format
```

## Docs

- [Development Guide](./DEVELOPERS.md)
- [Testing Standards](./docs/testing.md)
- [Temporal Primitives](./docs/temporal-primitives.md)
- [Temporal Patterns](./docs/temporal-patterns.md)
- [Write a New Workflow](./docs/write-new-workflow.md)

## License

[MIT License](./LICENSE)
