import { afterEach, describe, expect, it, vi } from 'vitest';

import { httpGet } from './http_activities';

describe('httpGet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return the response body when the HTTP request succeeds', async () => {
    const expectedResponseText = '{"id": 1, "title": "Test Post", "userId": 1}';
    const testUrl = 'https://api.example.com/posts/1';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(expectedResponseText, { status: 200 }));

    const result = await httpGet({ url: testUrl });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0].toString()).toBe(testUrl);
    expect(result.responseText).toBe(expectedResponseText);
    expect(result.statusCode).toBe(200);
  });

  it.each(['not-a-valid-url', '', 'https://'])(
    'should reject invalid URLs: %s',
    async (invalidUrl) => {
      await expect(httpGet({ url: invalidUrl })).rejects.toThrow(TypeError);
    },
  );
});
