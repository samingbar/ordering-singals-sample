import { expect, it } from 'vitest';

import { noopActivity } from './load_generator_activities';

it('should process the noop activity input', async () => {
  const result = await noopActivity({ message: 'test' });

  expect(result.message).toBe('processed: test');
});
