import {
  validatePublicationEnvelope,
  type PublicationEnvelope,
} from '@trebla/publishing-contracts';

export interface IntakePrincipal {
  tenant: string;
  clientId: string;
  nonce: string;
}

export type IntakeCapacity =
  | { accepted: true }
  | { accepted: false; retryAfter: string };

export interface AtomicAcceptance {
  envelope: PublicationEnvelope;
  principal: IntakePrincipal;
}

export interface AtomicIntakeStore {
  findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<string | null>;
  acceptAtomic(acceptance: AtomicAcceptance): Promise<string>;
}

export type IntakeResult =
  | { outcome: 'accepted'; publicationId: string }
  | {
    outcome: 'retry-later';
    code: 'FREE_TIER_BUDGET_EXHAUSTED';
    publicationAccepted: false;
    retryAfter: string;
  };

export async function acceptPublication(input: {
  envelope: unknown;
  principal: IntakePrincipal;
  store: AtomicIntakeStore;
  capacity: IntakeCapacity;
}): Promise<IntakeResult> {
  const envelope = validatePublicationEnvelope(input.envelope);
  if (envelope.identity.tenant !== input.principal.tenant) {
    throw new Error('Publication tenant does not match authenticated tenant');
  }

  const existing = await input.store.findByIdempotencyKey(
    input.principal.tenant,
    envelope.identity.idempotencyKey,
  );
  if (existing) return { outcome: 'accepted', publicationId: existing };

  if (!input.capacity.accepted) {
    return {
      outcome: 'retry-later',
      code: 'FREE_TIER_BUDGET_EXHAUSTED',
      publicationAccepted: false,
      retryAfter: input.capacity.retryAfter,
    };
  }

  const publicationId = await input.store.acceptAtomic({
    envelope,
    principal: input.principal,
  });
  return { outcome: 'accepted', publicationId };
}
