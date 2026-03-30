# Development Guide

This template is set up for Temporal development with the TypeScript SDK.

## Tooling

- **npm** for dependency management and scripts
- **TypeScript** for static typing
- **Vitest** for tests and coverage
- **Biome** for linting and formatting

## Common Commands

```bash
# Install dependencies
npm install

# Type-check the project
npm run build

# Run the test suite with coverage
npm test

# Lint the codebase
npm run lint

# Format the codebase
npm run format
```

## Sample Commands

```bash
# HTTP sample
npm run worker:http
npm run workflow:http

# Crawler sample
npm run worker:crawler
npm run workflow:crawler

# Load generator sample
npm run worker:load-generator
npm run workflow:load-generator

# Offline ordering demo
npm run worker:purchase-order
npm run server:api
npm run server:vendor-sim

# Or run the full demo stack together
npm run demo
```

## Testing Notes

- Activity tests can call the activity directly and mock `fetch` or helper functions.
- Workflow tests should use Temporal's `TestWorkflowEnvironment`.
- Use time-skipping tests when the workflow uses timers and the test can safely fast-forward.
- Use local tests when real waiting is simpler than forcing time-skipping behavior.

## Workflow Authoring Notes

- Export workflow functions from workflow modules.
- Use `proxyActivities` instead of importing activity implementations into workflow code.
- Keep workflow payloads serializable plain objects.
- Keep Node-only APIs out of workflow modules unless they are only used in non-workflow scripts.

## Worker Notes

- Worker modules should stay thin.
- Register activities as an object and point `workflowsPath` at the workflow module file.
- Reuse the shared connection helpers from `src/shared/temporal.ts`.
- Keep demo app servers thin and push orchestration behavior into workflow/activity modules.
