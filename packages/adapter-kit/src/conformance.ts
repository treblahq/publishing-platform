import { validateDeliveryReceipt, type DeliveryReceipt } from '@trebla/publishing-contracts';

import { assertAdapterSupports, validateAdapterManifest } from './manifest.js';
import type { AdapterContext, DeliveryAdapter } from './types.js';

export interface AdapterConformanceReport {
  remoteEffects: number;
}

export async function runAdapterConformance<
  TConfig,
  TPayload extends Record<string, unknown>,
  TReceipt extends DeliveryReceipt,
>(
  adapter: DeliveryAdapter<TConfig, TPayload, TReceipt>,
  fixture: AdapterContext<TConfig, TPayload>,
): Promise<AdapterConformanceReport> {
  const manifest = validateAdapterManifest(adapter.manifest);
  const payloadType = fixture.payload.type;
  if (typeof payloadType !== 'string') throw new Error('Conformance payload type is required');
  assertAdapterSupports(
    manifest,
    payloadType as (typeof manifest.channels)[number],
    fixture.operation,
  );

  const firstValidation = await adapter.validate(fixture);
  const secondValidation = await adapter.validate(fixture);
  if (JSON.stringify(firstValidation) !== JSON.stringify(secondValidation)) {
    throw new Error('Adapter validation must be deterministic');
  }
  if (!firstValidation.valid) throw new Error('Conformance fixture must be valid');

  const firstReceipt = validateDeliveryReceipt(await adapter.deliver(fixture)) as TReceipt;
  const duplicateReceipt = validateDeliveryReceipt(await adapter.deliver(fixture)) as TReceipt;
  if (firstReceipt.remoteId !== duplicateReceipt.remoteId) {
    throw new Error('Duplicate delivery created more than one remote effect');
  }

  if (manifest.capabilities.reconciliation) {
    const result = await adapter.reconcile({ ...fixture, receipt: firstReceipt });
    if (result.status !== 'found' || result.receipt.remoteId !== firstReceipt.remoteId) {
      throw new Error('Adapter reconciliation did not recover the delivered effect');
    }
  }

  return { remoteEffects: new Set([firstReceipt.remoteId, duplicateReceipt.remoteId]).size };
}
