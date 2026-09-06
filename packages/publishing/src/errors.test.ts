import { describe, expect, it } from 'vitest';

import { DeliveryError, redactErrorMessage } from './errors.js';

describe('delivery errors', () => {
  it('preserves a normalized retry category without exposing its cause', () => {
    const error = new DeliveryError({
      code: 'PROVIDER_RATE_LIMITED',
      category: 'rate-limited',
      message: 'Provider asked the platform to retry later',
      retryAfter: '2026-09-05T00:05:00.000Z',
      cause: new Error('Authorization: Bearer private-token'),
    });

    expect(error.category).toBe('rate-limited');
    expect(error.retryAfter).toBe('2026-09-05T00:05:00.000Z');
    expect(JSON.stringify(error)).not.toContain('private-token');
  });

  it('redacts authorization, token, secret, and password values', () => {
    const message = 'Authorization: Bearer abc token=def secret: ghi password=jkl';
    const redacted = redactErrorMessage(message);
    expect(redacted).not.toMatch(/abc|def|ghi|jkl/u);
    expect(redacted.match(/\[REDACTED\]/gu)).toHaveLength(4);
  });
});
