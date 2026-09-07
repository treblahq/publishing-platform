import { DeliveryError, type DeliveryReceipt } from '@trebla/publishing';
import type { AdapterContext, DeliveryAdapter } from '@trebla/publishing-adapter-kit';

export interface SocialShadowPayload extends Record<string, unknown> {
  type: 'social.post';
  text: string;
  artifactIds: string[];
}

interface SocialShadowDependencies {
  now?(): Date;
}

export function createSocialShadowAdapter(
  dependencies: SocialShadowDependencies = {},
): DeliveryAdapter<Record<string, never>, SocialShadowPayload> {
  const now = dependencies.now ?? (() => new Date());
  return {
    manifest: {
      contractVersion: 1,
      name: 'social.shadow',
      channels: ['social.post'],
      operations: ['compare'],
      capabilities: {
        providerIdempotency: true,
        reconciliation: true,
        asynchronousIngestion: false,
      },
    },
    validate: (context) => Promise.resolve(validateContext(context)),
    deliver: async (context) => {
      const validation = validateContext(context);
      if (!validation.valid) throw invalidPayload(validation.issues);
      return {
        provider: 'social.shadow',
        remoteId: `shadow:${await fingerprint(context)}`,
        acceptedAt: now().toISOString(),
      };
    },
    reconcile: (context) => Promise.resolve(isShadowReceipt(context.receipt)
      ? { status: 'found', receipt: context.receipt }
      : { status: 'unknown' }),
    artifactRetention: () => Promise.resolve({
      safeToDelete: false,
      reason: 'shadow-has-no-provider-ingestion',
    }),
  };
}

function validateContext(context: AdapterContext<unknown, unknown>) {
  const payload = record(context.payload);
  const artifactIds = payload?.artifactIds;
  const issues: string[] = [];
  if (context.operation !== 'compare') issues.push('Shadow operation must be compare');
  if (payload?.type !== 'social.post') issues.push('Shadow payload must be social.post');
  if (typeof payload?.text !== 'string' || payload.text.trim().length === 0) {
    issues.push('Shadow social text is required');
  }
  if (!Array.isArray(artifactIds) || artifactIds.length === 0
    || artifactIds.some((id) => typeof id !== 'string' || id.trim().length === 0)
    || new Set(artifactIds).size !== artifactIds.length) {
    issues.push('Shadow artifact IDs must be a non-empty unique list');
  }
  return issues.length === 0 ? { valid: true as const } : { valid: false as const, issues };
}

async function fingerprint(context: AdapterContext<Record<string, never>, SocialShadowPayload>) {
  const source = JSON.stringify({
    tenant: context.tenant,
    deliveryId: context.deliveryId,
    idempotencyKey: context.idempotencyKey,
    operation: context.operation,
    text: context.payload.text,
    artifactIds: context.payload.artifactIds,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isShadowReceipt(value: DeliveryReceipt | undefined): value is DeliveryReceipt {
  return value?.provider === 'social.shadow' && /^shadow:[a-f0-9]{64}$/u.test(value.remoteId);
}

function invalidPayload(issues: readonly string[]) {
  return new DeliveryError({
    code: 'SOCIAL_SHADOW_INVALID_PAYLOAD',
    category: 'terminal',
    message: issues.join('; '),
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
