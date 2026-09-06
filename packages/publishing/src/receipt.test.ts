import { describe, expect, it } from 'vitest';

import { validateDeliveryReceipt } from './receipt.js';

const validReceipt = {
  provider: 'onesignal',
  remoteId: 'notification-123',
  acceptedAt: '2026-09-04T15:00:00.000Z',
  remoteUrl: 'https://dashboard.onesignal.com/notifications/notification-123',
  metadata: { status: 'accepted' },
};

describe('delivery receipts', () => {
  it('accepts minimal provider evidence', () => {
    expect(validateDeliveryReceipt(validReceipt)).toEqual(validReceipt);
  });

  it.each([
    ['missing remote ID', { ...validReceipt, remoteId: '' }],
    ['invalid acceptance time', { ...validReceipt, acceptedAt: 'today' }],
    ['invalid remote URL', { ...validReceipt, remoteUrl: 'not-a-url' }],
    ['secret metadata', { ...validReceipt, metadata: { accessToken: 'private' } }],
  ])('rejects %s', (_label, receipt) => {
    expect(() => validateDeliveryReceipt(receipt)).toThrow();
  });
});
