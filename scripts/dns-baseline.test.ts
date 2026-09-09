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

  test.each([
    { type: 'A', data: ['192.0.2.20', '192.0.2.10', '192.0.2.20'], expected: ['192.0.2.10', '192.0.2.20'] },
    { type: 'AAAA', data: ['2001:DB8::B', '2001:db8::a', '2001:db8::b'], expected: ['2001:db8::a', '2001:db8::b'] },
    { type: 'CNAME', data: ['WWW.EXAMPLE.COM.', 'www.example.com.'], expected: ['www.example.com'] },
    { type: 'MX', data: ['20 BACKUP.EXAMPLE.COM.', '10 MAIL.EXAMPLE.COM.', '10 mail.example.com.'], expected: ['10 mail.example.com', '20 backup.example.com'] },
  ] as const)('normalizes $type answers deterministically', ({ type, data, expected }) => {
    expect(normalizeDnsAnswers(data.map(value => ({ data: value })), type)).toEqual(expected);
  });

  test.each(['TXT', 'CAA'] as const)('preserves opaque %s data while sorting and deduplicating exact matches', type => {
    const values = type === 'TXT'
      ? ['token=abc', '"Part One" "Part Two"', 'token=AbC.', 'token=AbC', 'token=AbC']
      : ['0 issue "CA.EXAMPLE"', '0 issue "ca.example"', '0 issue "CA.EXAMPLE"'];
    const expected = type === 'TXT'
      ? ['"Part One" "Part Two"', 'token=AbC', 'token=AbC.', 'token=abc']
      : ['0 issue "CA.EXAMPLE"', '0 issue "ca.example"'];

    expect(normalizeDnsAnswers(values.map(data => ({ data })), type)).toEqual(expected);
  });

  test.each([
    { name: 'openings.dev', before: '"verification=AbCd123"', after: '"verification=abcd123"' },
    { name: 'selector._domainkey.openings.dev', before: '"v=DKIM1; p=AbCd"', after: '"v=DKIM1; p=abcd"' },
  ])('blocks a case-only TXT mutation at $name after normalization', ({ name, before, after }) => {
    const baseline: DnsBaseline = {
      ...BASELINE,
      records: [{ name, type: 'TXT', values: normalizeDnsAnswers([{ data: before }], 'TXT') }],
    };
    const proposed: DnsBaseline = {
      ...baseline,
      records: [{ name, type: 'TXT', values: normalizeDnsAnswers([{ data: after }], 'TXT') }],
    };

    expect(compareDnsBaselines(baseline, proposed)).toEqual({
      safe: false,
      protectedChanges: [{ name, type: 'TXT', before: [before], after: [after] }],
      webChanges: [],
    });
  });
});
