import {
  DeliveryError,
  type DeliveryReceipt,
} from '@trebla/publishing-contracts';
import type {
  AdapterContext,
  DeliveryAdapter,
  ReconcileContext,
} from '@trebla/publishing-adapter-kit';

import { FaultScript, type FakeAdapterFault } from './fault-script.js';

export interface FakeAdapterOptions {
  faults?: readonly FakeAdapterFault[];
  asynchronousIngestion?: boolean;
}

export interface FakeAdapter extends DeliveryAdapter<Record<string, never>> {
  effectCount(): number;
  confirmArtifactIngestion(artifactId: string): void;
}

export function createFakeAdapter(options: FakeAdapterOptions = {}): FakeAdapter {
  const faults = new FaultScript(options.faults);
  const effects = new Map<string, DeliveryReceipt>();
  const ingestedArtifacts = new Set<string>();

  return {
    manifest: {
      contractVersion: 1,
      name: 'test.fake',
      channels: ['web.page', 'push.notification', 'social.post', 'video.upload'],
      operations: ['publish'],
      capabilities: {
        providerIdempotency: true,
        reconciliation: true,
        asynchronousIngestion: options.asynchronousIngestion ?? false,
      },
    },
    validate: () => Promise.resolve({ valid: true }),
    deliver: (context) => {
      const fault = faults.next();
      if (fault === 'before-effect') {
        return Promise.reject(deliveryError('FAKE_TRANSIENT', 'retryable'));
      }
      if (fault === 'rate-limited') {
        return Promise.reject(new DeliveryError({
          code: 'FAKE_RATE_LIMIT',
          category: 'rate-limited',
          message: 'Fake provider rate limit',
          retryAfter: '2026-09-04T00:05:00.000Z',
        }));
      }
      if (fault === 'credential') {
        return Promise.reject(deliveryError('FAKE_CREDENTIAL', 'credential'));
      }
      if (fault === 'terminal') {
        return Promise.reject(deliveryError('FAKE_TERMINAL', 'terminal'));
      }
      if (fault === 'malformed-response') {
        return Promise.resolve({ malformed: true } as unknown as DeliveryReceipt);
      }

      const receipt = effects.get(context.idempotencyKey) ?? createReceipt(context);
      effects.set(context.idempotencyKey, receipt);
      if (fault === 'after-effect-before-response') {
        return Promise.reject(deliveryError('FAKE_LOST_RESPONSE', 'ambiguous'));
      }
      return Promise.resolve(receipt);
    },
    reconcile: (context) => reconcileEffect(context, effects),
    artifactRetention: ({ artifact }) => {
      const safeToDelete = !options.asynchronousIngestion || ingestedArtifacts.has(artifact.id);
      return Promise.resolve({
        safeToDelete,
        reason: safeToDelete ? 'provider-ingestion-confirmed' : 'provider-ingestion-pending',
      });
    },
    effectCount: () => effects.size,
    confirmArtifactIngestion: (artifactId) => {
      ingestedArtifacts.add(artifactId);
    },
  };
}

function createReceipt(context: AdapterContext): DeliveryReceipt {
  return {
    provider: 'test.fake',
    remoteId: `remote:${context.idempotencyKey}`,
    acceptedAt: '2026-09-04T00:00:00.000Z',
  };
}

function reconcileEffect(
  context: ReconcileContext,
  effects: ReadonlyMap<string, DeliveryReceipt>,
) {
  const receipt = effects.get(context.idempotencyKey);
  return Promise.resolve(receipt
    ? { status: 'found' as const, receipt }
    : { status: 'absent' as const });
}

function deliveryError(
  code: string,
  category: 'retryable' | 'ambiguous' | 'credential' | 'terminal',
): DeliveryError {
  return new DeliveryError({ code, category, message: `Fake adapter fault: ${code}` });
}
