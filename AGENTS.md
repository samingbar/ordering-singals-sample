# Temporal TypeScript SDK Project Template

## Project Overview

This repository is a **Temporal TypeScript SDK sample template**. It contains three focused SDK samples plus one larger end-to-end demo:

- `http`: a workflow that calls an HTTP activity
- `crawler`: a workflow that fans out crawling work through activities
- `load_generator`: a workflow that repeatedly spawns child workflows to create load
- `purchase_order`: a long-running ordering workflow with signals, queries, exception timers, projections, and demo UIs

The template is designed for agent-driven development, so the repository keeps workflow code, activity code, worker startup, run scripts, and tests close together.

## Tech Stack

- **Temporal TypeScript SDK**
- **TypeScript 5**
- **Node.js 22+**
- **npm**
- **Vitest** for tests and coverage
- **Biome** for linting and formatting

## Project Structure

```text
src/
├── apps/
│   ├── api/                          # Demo API and internal UI
│   └── vendor_sim/                  # Vendor-facing simulator service and UI
├── shared/
│   ├── temporal.ts                   # Shared Temporal client / worker connection helpers
│   └── offline_ordering/             # Purchase-order domain rules and file-backed demo projections
├── test/
│   └── temporal.ts                   # Temporal test environment helpers
└── workflows/
    ├── http/
    │   └── ...
    ├── crawler/
    │   └── ...
    ├── load_generator/
    │   └── ...
    └── purchase_order/
        ├── purchase_order_activities.ts
        ├── purchase_order_activities.test.ts
        ├── purchase_order_workflow.ts
        ├── purchase_order_workflow.test.ts
        └── worker.ts
```

## Key Concepts For AI Assistants

### Workflow Rules

Workflows in this project are exported async functions that use Temporal workflow APIs such as:

- `proxyActivities`
- `executeChild`
- `sleep`
- `log`

Workflow code must stay deterministic:

- no direct HTTP requests
- no filesystem access
- no random IDs, `process.env`, or other host-environment inspection inside workflow logic
- use Temporal-safe workflow time only; in TypeScript workflows `Date.now()` is deterministic

If a workflow needs side effects, move them into an activity.

### Activity Rules

Activities handle non-deterministic work such as:

- HTTP requests
- parsing external content
- interacting with services

Activities are plain exported async functions. Use plain serializable objects for activity input and output.

### Testing

Tests use:

- `TestWorkflowEnvironment.createTimeSkipping()` for workflow integration tests
- `TestWorkflowEnvironment.createLocal()` when real waiting is simpler than time skipping
- direct unit tests or spies for activity behavior

Keep tests focused on user-visible behavior and orchestration outcomes.

## Development Guidelines

### Commands

```bash
npm install
npm run build
npm test
npm run lint
npm run format

npm run worker:http
npm run workflow:http
npm run worker:crawler
npm run workflow:crawler
npm run worker:load-generator
npm run workflow:load-generator
npm run worker:purchase-order
npm run server:api
npm run server:vendor-sim
npm run demo
```

### When Working With This Project

1. Keep workflow modules free of Node-only side effects.
2. Prefer typed plain objects over classes for workflow and activity payloads.
3. Add or update Vitest coverage when changing workflow logic.
4. Keep worker startup and run scripts small and explicit.
5. Preserve the sample-oriented structure unless the user asks for a larger refactor.
6. Keep API and simulator layers as thin adapters over workflow signals, queries, and activities.

### Adding A New Workflow

1. Create a folder under `src/workflows/`.
2. Add an activity module.
3. Add a workflow module that uses `proxyActivities`.
4. Add a worker module with `Worker.create`.
5. Add a `run.ts` script that starts or executes the workflow.
6. Add `*.test.ts` files for activities and workflow behavior.

### Security Considerations

- Validate external URLs and inputs before using them in activities.
- Use environment variables for addresses or credentials.
- Keep secrets out of workflow history.
- Treat all activity input as untrusted external data.
