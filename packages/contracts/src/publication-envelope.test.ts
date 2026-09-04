import { describe, expect, it } from 'vitest';

import { validatePublicationEnvelope } from './publication-envelope.js';

function validEnvelope() {
  return {
    schemaVersion: 1,
    identity: {
      tenant: 'openings',
      sourceType: 'job',
      sourceId: 'job-123',
      revision: 'rev-1',
      idempotencyKey: 'openings:job:job-123:rev-1',
    },
    canonical: {
      title: 'Senior Engineer',
      summary: 'A new opportunity',
      canonicalUrl: 'https://openings.dev/jobs/job-123/',
      language: 'en',
    },
    artifacts: [],
    deliveries: [
      {
        id: 'web',
        adapter: 'web.r2',
        operation: 'publish',
        required: true,
        payload: { type: 'web.page', route: '/jobs/job-123/' },
      },
      {
        id: 'push',
        adapter: 'push.onesignal',
        operation: 'publish',
        required: true,
        dependsOn: [{ deliveryId: 'web', state: 'verified' }],
        payload: {
          type: 'push.notification',
          audience: { type: 'all-subscribers' },
          title: 'New job',
          body: 'Senior Engineer',
          url: 'https://openings.dev/jobs/job-123/',
        },
      },
    ],
  };
}

type EnvelopeFixture = ReturnType<typeof validEnvelope>;

function delivery(value: EnvelopeFixture, index: number) {
  const result = value.deliveries[index];
  if (result === undefined) throw new Error(`Missing delivery fixture at ${String(index)}`);
  return result;
}

function firstDependency(value: EnvelopeFixture) {
  const result = delivery(value, 1).dependsOn?.[0];
  if (result === undefined) throw new Error('Missing dependency fixture');
  return result;
}

describe('publication envelope', () => {
  it('accepts a web delivery followed by verified-dependent push', () => {
    expect(validatePublicationEnvelope(validEnvelope())).toEqual(validEnvelope());
  });

  it.each([
    ['unknown schema', (value: EnvelopeFixture) => { value.schemaVersion = 2; }],
    ['duplicate delivery ID', (value: EnvelopeFixture) => { delivery(value, 1).id = 'web'; }],
    ['missing dependency', (value: EnvelopeFixture) => {
      firstDependency(value).deliveryId = 'missing';
    }],
    ['self dependency', (value: EnvelopeFixture) => {
      firstDependency(value).deliveryId = 'push';
    }],
    ['secret-like field', (value: EnvelopeFixture) => {
      Object.assign(value, { apiToken: 'not-allowed' });
    }],
    ['executable value', (value: EnvelopeFixture) => {
      Object.assign(delivery(value, 0).payload, { render: () => 'html' });
    }],
  ] satisfies Array<[string, (value: EnvelopeFixture) => void]>)('rejects %s', (_label, mutate) => {
    const value = validEnvelope();
    mutate(value);
    expect(() => validatePublicationEnvelope(value)).toThrow();
  });

  it('rejects dependency cycles', () => {
    const value = validEnvelope();
    delivery(value, 0).dependsOn = [{ deliveryId: 'push', state: 'verified' }];
    expect(() => validatePublicationEnvelope(value)).toThrow('Delivery dependency cycle');
  });
});
