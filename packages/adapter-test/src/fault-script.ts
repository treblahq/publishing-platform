export const FAKE_ADAPTER_FAULTS = [
  'before-effect',
  'after-effect-before-response',
  'malformed-response',
  'rate-limited',
  'credential',
  'terminal',
] as const;

export type FakeAdapterFault = (typeof FAKE_ADAPTER_FAULTS)[number];

export class FaultScript {
  readonly #faults: FakeAdapterFault[];

  constructor(faults: readonly FakeAdapterFault[] = []) {
    this.#faults = [...faults];
  }

  next(): FakeAdapterFault | undefined {
    return this.#faults.shift();
  }
}
