import type { DeliveryAdapter } from '@trebla/publishing-adapter-kit';
import { DeliveryError, type DeliveryReceipt } from '@trebla/publishing-contracts';

export interface OneSignalUsageAttestation {
  observedMobileMau: number;
  providerCeiling: number;
  internalPause: number;
  observedAt: string;
  expiresAt: string;
  evidenceHash: string;
}

export interface OneSignalConfig {
  appId: string;
  restApiKey: string;
  audienceMode: 'production-broadcast' | 'staging-segment';
  testSegment?: string;
  attestation: OneSignalUsageAttestation;
}

export interface OneSignalPushPayload extends Record<string, unknown> {
  type: 'push.notification';
  audience: { type: 'all-subscribers' };
  title: string;
  body: string;
  url?: string;
}

export interface OneSignalRequest {
  url: string;
  headers: Readonly<Record<string, string>>;
  body: Readonly<Record<string, unknown>>;
}

export interface OneSignalResponse {
  status: number;
  body: unknown;
  retryAfter?: string;
}

interface OneSignalDependencies {
  send(request: OneSignalRequest): Promise<OneSignalResponse>;
  now(): Date;
}

export function createOneSignalAdapter(
  dependencies: OneSignalDependencies,
): DeliveryAdapter<OneSignalConfig, OneSignalPushPayload> {
  return {
    manifest: {
      contractVersion: 1,
      name: 'push.onesignal',
      channels: ['push.notification'],
      operations: ['publish'],
      capabilities: {
        providerIdempotency: true,
        reconciliation: false,
        asynchronousIngestion: false,
      },
    },
    validate: (context) => Promise.resolve(validateContext(context.config, context.payload, dependencies.now())),
    deliver: async (context) => {
      const validation = validateContext(context.config, context.payload, dependencies.now());
      if (!validation.valid) {
        throw new DeliveryError({
          code: validation.freeTierUnproven ? 'ONESIGNAL_FREE_TIER_UNPROVEN' : 'ONESIGNAL_INVALID_PAYLOAD',
          category: validation.freeTierUnproven ? 'credential' : 'terminal',
          message: validation.issues.join('; '),
        });
      }
      const idempotencyKey = await deriveOneSignalIdempotencyKey(context.idempotencyKey);
      let response: OneSignalResponse;
      try {
        response = await dependencies.send({
          url: 'https://api.onesignal.com/notifications',
          headers: {
            Authorization: `Key ${context.config.restApiKey}`,
            'Content-Type': 'application/json',
          },
          body: {
            app_id: context.config.appId,
            included_segments: [resolveSegment(context.config)],
            headings: { en: context.payload.title },
            contents: { en: context.payload.body },
            ...(context.payload.url === undefined ? {} : { url: context.payload.url }),
            idempotency_key: idempotencyKey,
          },
        });
      } catch {
        throw providerError('ONESIGNAL_TRANSPORT', 'retryable', 'OneSignal transport failed before a response');
      }
      return parseResponse(response, dependencies.now());
    },
    reconcile: () => Promise.resolve({ status: 'unknown' }),
  };
}

export async function deriveOneSignalIdempotencyKey(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x80;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateContext(config: OneSignalConfig, payload: OneSignalPushPayload, now: Date) {
  const issues: string[] = [];
  if (config.appId.length === 0 || config.restApiKey.length === 0) issues.push('OneSignal credentials are required');
  const audienceMode: unknown = config.audienceMode;
  if (audienceMode !== 'production-broadcast' && audienceMode !== 'staging-segment') {
    issues.push('OneSignal audience mode is required');
  }
  if (config.audienceMode === 'staging-segment' && (typeof config.testSegment !== 'string' || config.testSegment.trim().length === 0)) {
    issues.push('OneSignal staging test segment is required');
  }
  if (payload.title.length === 0 || payload.body.length === 0) issues.push('Push title and body are required');
  const attestation = config.attestation;
  const expiry = Date.parse(attestation.expiresAt);
  const observation = Date.parse(attestation.observedAt);
  const freeTierUnproven = !Number.isSafeInteger(attestation.observedMobileMau)
    || attestation.observedMobileMau < 0
    || attestation.providerCeiling !== 1_000
    || attestation.internalPause !== 700
    || attestation.observedMobileMau >= attestation.internalPause
    || !Number.isFinite(expiry)
    || !Number.isFinite(observation)
    || observation > now.getTime()
    || expiry <= now.getTime()
    || expiry - observation > 7 * 24 * 60 * 60 * 1_000
    || !/^[a-f0-9]{64}$/u.test(attestation.evidenceHash);
  if (freeTierUnproven) issues.push('OneSignal free-tier usage cannot be proven');
  return issues.length === 0
    ? { valid: true as const }
    : { valid: false as const, issues, freeTierUnproven };
}

function resolveSegment(config: OneSignalConfig): string {
  return config.audienceMode === 'production-broadcast'
    ? 'Subscribed Users'
    : config.testSegment as string;
}

function parseResponse(response: OneSignalResponse, now: Date): DeliveryReceipt {
  if (response.status === 401 || response.status === 403) {
    throw providerError('ONESIGNAL_CREDENTIAL', 'credential', 'OneSignal rejected its configured credential');
  }
  if (response.status === 429) {
    throw new DeliveryError({
      code: 'ONESIGNAL_RATE_LIMIT',
      category: 'rate-limited',
      message: 'OneSignal rate limit reached',
      ...(response.retryAfter === undefined ? {} : { retryAfter: response.retryAfter }),
    });
  }
  if (response.status >= 500) {
    throw providerError('ONESIGNAL_UNAVAILABLE', 'retryable', 'OneSignal is temporarily unavailable');
  }
  if (response.status < 200 || response.status >= 300) {
    throw providerError('ONESIGNAL_REJECTED', 'terminal', 'OneSignal rejected the notification');
  }
  const body = asRecord(response.body);
  if (typeof body?.id !== 'string' || body.id.length === 0) {
    throw providerError('ONESIGNAL_MALFORMED_RESPONSE', 'ambiguous', 'OneSignal returned an unusable success response');
  }
  return { provider: 'push.onesignal', remoteId: body.id, acceptedAt: now.toISOString() };
}

function providerError(
  code: string,
  category: 'retryable' | 'ambiguous' | 'credential' | 'terminal',
  message: string,
): DeliveryError {
  return new DeliveryError({ code, category, message });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
