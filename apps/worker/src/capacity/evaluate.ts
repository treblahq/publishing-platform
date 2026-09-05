export type CapacityState = 'normal' | 'warning' | 'reject';

export interface CapacityDecision {
  state: CapacityState;
  accepted: boolean;
  projected: number;
  reason: 'within-budget' | 'warning-threshold' | 'reject-threshold' | 'usage-uncertain';
}

export interface CapacityInput {
  used: number;
  reserved: number;
  requested: number;
  internalBudget: number;
  measuredAt: Date | undefined;
  now: Date;
  maxAgeMs: number;
}

export function evaluateCapacity(input: CapacityInput): CapacityDecision {
  const projected = input.used + input.reserved + input.requested;
  if (
    input.measuredAt === undefined
    || input.measuredAt.getTime() > input.now.getTime()
    || input.now.getTime() - input.measuredAt.getTime() > input.maxAgeMs
    || !allNonNegative([input.used, input.reserved, input.requested])
    || !Number.isFinite(input.internalBudget)
    || input.internalBudget <= 0
  ) {
    return { state: 'reject', accepted: false, projected, reason: 'usage-uncertain' };
  }

  const ratio = projected / input.internalBudget;
  if (ratio >= 0.7) {
    return { state: 'reject', accepted: false, projected, reason: 'reject-threshold' };
  }
  if (ratio >= 0.6) {
    return { state: 'warning', accepted: true, projected, reason: 'warning-threshold' };
  }
  return { state: 'normal', accepted: true, projected, reason: 'within-budget' };
}

export type R2ArtifactClass = 'temporary' | 'live-essential' | 'live-nonessential';

export function evaluateR2Capacity(
  currentBytes: number,
  requestedBytes: number,
  artifactClass: R2ArtifactClass,
): CapacityDecision {
  const projected = currentBytes + requestedBytes;
  const gibibyte = 1024 ** 3;
  if (!allNonNegative([currentBytes, requestedBytes])) {
    return { state: 'reject', accepted: false, projected, reason: 'usage-uncertain' };
  }
  if (projected >= 7 * gibibyte || (artifactClass === 'live-nonessential' && projected >= 5 * gibibyte)) {
    return { state: 'reject', accepted: false, projected, reason: 'reject-threshold' };
  }
  if (projected >= 4 * gibibyte) {
    return { state: 'warning', accepted: true, projected, reason: 'warning-threshold' };
  }
  return { state: 'normal', accepted: true, projected, reason: 'within-budget' };
}

function allNonNegative(values: readonly number[]): boolean {
  return values.every((value) => Number.isSafeInteger(value) && value >= 0);
}
