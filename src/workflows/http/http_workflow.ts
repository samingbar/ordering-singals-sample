import { log, proxyActivities } from '@temporalio/workflow';

import type * as httpActivities from './http_activities';

export const HTTP_TASK_QUEUE = 'http-task-queue';

export interface HttpWorkflowInput {
  url: string;
}

export interface HttpWorkflowOutput {
  responseText: string;
  url: string;
  statusCode: number;
}

const { httpGet } = proxyActivities<typeof httpActivities>({
  startToCloseTimeout: '3 seconds',
});

export async function httpWorkflow(input: HttpWorkflowInput): Promise<HttpWorkflowOutput> {
  log.info('Workflow: triggering HTTP GET activity', { url: input.url });

  const activityResult = await httpGet({ url: input.url });

  return {
    responseText: activityResult.responseText,
    url: input.url,
    statusCode: activityResult.statusCode,
  };
}
