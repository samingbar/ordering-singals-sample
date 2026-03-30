import { Context } from '@temporalio/activity';

export interface NoopActivityInput {
  message: string;
}

export interface NoopActivityOutput {
  message: string;
}

function getLogger(): Pick<Console, 'info'> {
  try {
    return Context.current().log;
  } catch {
    return console;
  }
}

export async function noopActivity(input: NoopActivityInput): Promise<NoopActivityOutput> {
  getLogger().info('Processing noop activity', { message: input.message });

  return {
    message: `processed: ${input.message}`,
  };
}
