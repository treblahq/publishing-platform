export const DELIVERY_ERROR_CATEGORIES = [
  'retryable',
  'rate-limited',
  'ambiguous',
  'credential',
  'terminal',
] as const;

export type DeliveryErrorCategory = (typeof DELIVERY_ERROR_CATEGORIES)[number];

export interface DeliveryErrorOptions {
  code: string;
  category: DeliveryErrorCategory;
  message: string;
  retryAfter?: string;
  cause?: unknown;
}

export class DeliveryError extends Error {
  readonly code: string;
  readonly category: DeliveryErrorCategory;
  readonly retryAfter: string | undefined;

  constructor(options: DeliveryErrorOptions) {
    super(redactErrorMessage(options.message), { cause: options.cause });
    this.name = 'DeliveryError';
    this.code = options.code;
    this.category = options.category;
    this.retryAfter = options.retryAfter;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      ...(this.retryAfter === undefined ? {} : { retryAfter: this.retryAfter }),
    };
  }
}

export function redactErrorMessage(message: string): string {
  return message
    .replace(/(authorization\s*:\s*(?:bearer\s+)?)[^\s,;]+/giu, '$1[REDACTED]')
    .replace(/((?:token|secret|password)\s*[:=]\s*)[^\s,;]+/giu, '$1[REDACTED]');
}
