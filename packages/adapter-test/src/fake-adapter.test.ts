import { describe, expect, it } from 'vitest';

import { runAdapterConformance } from '@trebla/publishing-adapter-kit';

import { createFakeAdapter } from './index.js';

const fixture = {
  tenant: 'openings',
  deliveryId: 'delivery-1',
  idempotencyKey: 'stable-delivery-1',
  operation: 'publish',
  config: {},
  payload: { type: 'social.post', text: 'A new job' },
  artifacts: [],
};

describe('fake adapter fault harness', () => {
  it('passes the common conformance contract', async () => {
    const adapter = createFakeAdapter() as Parameters<typeof runAdapterConformance>[0];
    await expect(runAdapterConformance(adapter, fixture)).resolves.toEqual({ remoteEffects: 1 });
  });

  it('recovers a lost response without creating a second effect', async () => {
    const adapter = createFakeAdapter({ faults: ['after-effect-before-response'] }) as {
      deliver(context: typeof fixture): Promise<{ remoteId: string }>;
      reconcile(context: typeof fixture & { receipt: undefined }): Promise<{ status: string }>;
      effectCount(): number;
    };

    await expect(adapter.deliver(fixture)).rejects.toMatchObject({ category: 'ambiguous' });
    await expect(adapter.reconcile({ ...fixture, receipt: undefined })).resolves.toMatchObject({
      status: 'found',
    });
    await expect(adapter.deliver(fixture)).resolves.toMatchObject({
      remoteId: 'remote:stable-delivery-1',
    });
    expect(adapter.effectCount()).toBe(1);
  });

  it.each([
    ['before-effect', 'retryable'],
    ['rate-limited', 'rate-limited'],
    ['credential', 'credential'],
    ['terminal', 'terminal'],
  ] as const)('normalizes the %s fault', async (fault, category) => {
    const adapter = createFakeAdapter({ faults: [fault] }) as {
      deliver(context: typeof fixture): Promise<unknown>;
    };
    await expect(adapter.deliver(fixture)).rejects.toMatchObject({ category });
  });

  it('returns malformed data only for the explicit malformed-response fault', async () => {
    const adapter = createFakeAdapter({ faults: ['malformed-response'] }) as {
      deliver(context: typeof fixture): Promise<unknown>;
    };
    await expect(adapter.deliver(fixture)).resolves.toEqual({ malformed: true });
  });

  it('lets the conformance harness reject malformed provider receipts', async () => {
    const adapter = createFakeAdapter({ faults: ['malformed-response'] }) as Parameters<
      typeof runAdapterConformance
    >[0];
    await expect(runAdapterConformance(adapter, fixture)).rejects.toThrow('receipt');
  });

  it('keeps temporary artifacts until provider ingestion is confirmed', async () => {
    const artifact = {
      id: 'video-1',
      storage: 'r2-temporary' as const,
      sha256: 'a'.repeat(64),
      byteSize: 10,
      mediaType: 'video/mp4',
      locator: 'r2://temporary/video-1',
    };
    const adapter = createFakeAdapter({ asynchronousIngestion: true }) as {
      artifactRetention(context: { artifact: typeof artifact; deliveryId: string; tenant: string; receipt: undefined }): Promise<{ safeToDelete: boolean }>;
      confirmArtifactIngestion(artifactId: string): void;
    };
    const context = { tenant: 'openings', deliveryId: 'delivery-1', artifact, receipt: undefined };

    await expect(adapter.artifactRetention(context)).resolves.toMatchObject({ safeToDelete: false });
    adapter.confirmArtifactIngestion(artifact.id);
    await expect(adapter.artifactRetention(context)).resolves.toMatchObject({ safeToDelete: true });
  });
});
