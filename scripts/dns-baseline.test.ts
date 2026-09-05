import { describe, expect, test } from 'vitest';

import { compareDnsBaselines } from './compare-dns-baseline.js';
import { normalizeDnsAnswers } from './capture-dns-baseline.js';
import type { DnsBaseline } from './capture-dns-baseline.js';

const BASELINE: DnsBaseline = {
  schemaVersion: 1,
  domain: 'openings.dev',
  capturedAt: '2026-09-05T12:00:00.000Z',
  records: [
    { name: 'openings.dev', type: 'A', values: ['192.0.2.10'] },
    { name: 'openings.dev', type: 'MX', values: ['10 mail.example.com'] },
    { name: 'openings.dev', type: 'TXT', values: ['v=spf1 include:example.com ~all'] },
    { name: '_dmarc.openings.dev', type: 'TXT', values: ['v=DMARC1; p=none'] },
    { name: 'selector._domainkey.openings.dev', type: 'TXT', values: ['v=DKIM1; p=abc'] },
  ],
};

describe('DNS cutover guard', () => {
  test('allows a web-only address change', () => {
    const proposed = structuredClone(BASELINE);
    proposed.records[0] = { name: 'openings.dev', type: 'A', values: ['198.51.100.20'] };

    expect(compareDnsBaselines(BASELINE, proposed)).toEqual({
      safe: true,
      protectedChanges: [],
      webChanges: [{ name: 'openings.dev', type: 'A', before: ['192.0.2.10'], after: ['198.51.100.20'] }],
    });
  });

  test.each(['MX', 'SPF', 'DKIM', 'DMARC'])('blocks a %s mutation', protectedKind => {
    const proposed = structuredClone(BASELINE);
    const index = { MX: 1, SPF: 2, DMARC: 3, DKIM: 4 }[protectedKind] ?? -1;
    const record = proposed.records[index];
    expect(record).toBeDefined();
    if (!record) throw new Error(`Missing ${protectedKind} fixture`);
    record.values = ['changed'];

    const result = compareDnsBaselines(BASELINE, proposed);

    expect(result.safe).toBe(false);
    expect(result.protectedChanges).toHaveLength(1);
  });

  test('normalizes DNS answers deterministically', () => {
    expect(normalizeDnsAnswers([
      { data: '"part one" "part two"' },
      { data: '10 MAIL.EXAMPLE.COM.' },
      { data: '10 mail.example.com.' },
    ])).toEqual(['10 mail.example.com', 'part onepart two']);
  });
});
