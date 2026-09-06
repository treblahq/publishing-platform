import type { ArtifactReference, DeliveryReceipt } from '@trebla/publishing';

import type { AdapterManifest } from './manifest.js';

export interface AdapterContext<TConfig = unknown, TPayload = Record<string, unknown>> {
  tenant: string;
  deliveryId: string;
  idempotencyKey: string;
  operation: string;
  config: TConfig;
  payload: TPayload;
  artifacts: readonly ArtifactReference[];
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; issues: readonly string[] };

export interface ReconcileContext<TConfig = unknown, TReceipt = DeliveryReceipt>
  extends AdapterContext<TConfig> {
  receipt: TReceipt | undefined;
}

export type ReconcileResult<TReceipt = DeliveryReceipt> =
  | { status: 'found'; receipt: TReceipt }
  | { status: 'absent' }
  | { status: 'unknown' };

export interface ArtifactRetentionContext<TReceipt = DeliveryReceipt> {
  tenant: string;
  deliveryId: string;
  artifact: ArtifactReference;
  receipt: TReceipt | undefined;
}

export interface ArtifactRetentionDecision {
  safeToDelete: boolean;
  reason: string;
}

export interface DeliveryAdapter<
  TConfig = unknown,
  TPayload = Record<string, unknown>,
  TReceipt extends DeliveryReceipt = DeliveryReceipt,
> {
  manifest: AdapterManifest;
  validate(context: AdapterContext<TConfig, TPayload>): Promise<ValidationResult>;
  deliver(context: AdapterContext<TConfig, TPayload>): Promise<TReceipt>;
  reconcile(context: ReconcileContext<TConfig, TReceipt>): Promise<ReconcileResult<TReceipt>>;
  artifactRetention?(
    context: ArtifactRetentionContext<TReceipt>,
  ): Promise<ArtifactRetentionDecision>;
}
