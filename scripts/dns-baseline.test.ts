import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { compareDnsBaselines } from './compare-dns-baseline.js';
import { captureDnsBaseline, normalizeDnsAnswers, queryDnsRecord } from './capture-dns-baseline.js';
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

describe('DNS response validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function respond(payload: unknown): void {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)));
  }

  test('captures each case-insensitive query once across defaults and extras', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: URL) => {
      requested.push(`${String(url.searchParams.get('name')).toLowerCase()}:${String(url.searchParams.get('type'))}`);
      return Promise.resolve(Response.json({ Status: 0 }));
    }));
    const baseline = await captureDnsBaseline('OPENINGS.DEV', [
      'openings.dev:txt', '_DMARC.OPENINGS.DEV:TXT',
      'WWW.OPENINGS.DEV:A', 'www.openings.dev:a',
    ]);
    expect(requested).toHaveLength(8);
    expect(new Set(requested).size).toBe(8);
    expect(baseline.records).toHaveLength(8);
    expect(compareDnsBaselines(baseline, baseline).safe).toBe(true);
  });

  test.each([{}, { Status: 2 }, { Status: 1 }, { Status: 5 }, { Status: '0' }, { Status: null }, null, []].map(payload => ({ payload })))(
    'rejects absent, failed, or malformed DNS status: $payload', async ({ payload }) => {
      respond(payload);
      await expect(queryDnsRecord('example.com', 'TXT')).rejects.toThrow(/DNS/);
    },
  );

  test.each([
    { Status: 0 }, { Status: 0, Answer: [] }, { Status: 0, TC: false },
    { Status: 3 }, { Status: 3, Answer: [] },
  ])('accepts explicit empty results: %j', async payload => {
    respond(payload);
    await expect(queryDnsRecord('EXAMPLE.COM', 'TXT')).resolves.toEqual({ name: 'example.com', type: 'TXT', values: [] });
  });

  test.each([true, 'false', 0, null])('rejects truncation or malformed TC: %j', async TC => {
    respond({ Status: 0, TC });
    await expect(queryDnsRecord('example.com', 'TXT')).rejects.toThrow(/DNS/);
  });

  test.each([
    null, {}, 'answer', [null], [[]], [{}], [{ type: 16 }], [{ type: 16, data: 4 }],
    [{ type: '16', data: 'secret' }], [{ type: -1, data: 'secret' }],
    [{ type: 1.5, data: 'secret' }], [{ type: 65536, data: 'secret' }],
    [{ type: 5, data: null }],
  ].map(Answer => ({ Answer })))('rejects malformed Answer: $Answer', async ({ Answer }) => {
    respond({ Status: 0, Answer });
    await expect(queryDnsRecord('example.com', 'TXT')).rejects.toThrow(/DNS/);
  });

  test('rejects NXDOMAIN with contradictory answers', async () => {
    respond({ Status: 3, Answer: [{ type: 5, data: 'alias.example.com.' }] });
    await expect(queryDnsRecord('example.com', 'TXT')).rejects.toThrow(/DNS/);
  });

  test.each([
    { type: 'A', numeric: 1, data: '192.0.2.10', expected: '192.0.2.10' },
    { type: 'AAAA', numeric: 28, data: '2001:DB8::A', expected: '2001:db8::a' },
    { type: 'CNAME', numeric: 5, data: 'ALIAS.EXAMPLE.COM.', expected: 'alias.example.com' },
    { type: 'MX', numeric: 15, data: '10 MAIL.EXAMPLE.COM.', expected: '10 mail.example.com' },
    { type: 'TXT', numeric: 16, data: '"Token=AbC."', expected: '"Token=AbC."' },
    { type: 'CAA', numeric: 257, data: '0 issue "CA.EXAMPLE"', expected: '0 issue "CA.EXAMPLE"' },
  ] as const)('selects only the requested $type answers', async ({ type, numeric, data, expected }) => {
    respond({ Status: 0, Answer: [{ type: 46, data: 'signature' }, { type: numeric, data }, { type: numeric, data }] });
    await expect(queryDnsRecord('example.com', type)).resolves.toEqual({ name: 'example.com', type, values: [expected] });
  });

  test('does not relabel a CNAME chain as TXT', async () => {
    respond({ Status: 0, Answer: [{ type: 5, data: 'alias.example.com.' }, { type: 16, data: '"Token=AbC"' }] });
    await expect(queryDnsRecord('example.com', 'TXT')).resolves.toEqual({ name: 'example.com', type: 'TXT', values: ['"Token=AbC"'] });
  });

  test('returns no TXT values for an answer containing only other types', async () => {
    respond({ Status: 0, Answer: [{ type: 5, data: 'alias.example.com.' }] });
    await expect(queryDnsRecord('example.com', 'TXT')).resolves.toMatchObject({ values: [] });
  });

  test('rejects HTTP errors without exposing the response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private-token', { status: 503 })));
    await expect(queryDnsRecord('example.com', 'TXT')).rejects.toThrow('DNS query failed for example.com TXT: HTTP 503');
  });

  test('rejects invalid JSON without exposing the response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private-token')));
    await expect(queryDnsRecord('example.com', 'TXT')).rejects.toThrow('DNS response contains invalid JSON');
  });

  test('cancels a streaming response larger than 256 KiB', async () => {
    const cancel = vi.fn();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls <= 5) controller.enqueue(new Uint8Array(65536).fill(32));
        else controller.close();
      },
      cancel,
    }, { highWaterMark: 0 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    await expect(queryDnsRecord('example.com', 'TXT')).rejects.toThrow(/DNS response exceeds/);
    expect(cancel).toHaveBeenCalledOnce();
  });

  test('accepts a valid response exactly 256 KiB long', async () => {
    const json = '{"Status":0}';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(json.padEnd(256 * 1024, ' '))));
    await expect(queryDnsRecord('example.com', 'TXT')).resolves.toMatchObject({ values: [] });
  });

  test('uses a 15 second abort signal for the HTTP request', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetchMock = vi.fn((_url: URL, options: RequestInit) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort();
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(queryDnsRecord('example.com', 'TXT')).rejects.toThrow('Aborted');
    expect(timeout).toHaveBeenCalledWith(15000);
  });
});

describe('DNS cutover guard', () => {
  const invalidBaselines: unknown[] = [
    null, [], {}, { records: [] },
    ...[undefined, 0, 2, '1'].map(schemaVersion => ({ ...BASELINE, schemaVersion })),
    ...[undefined, '', '   ', 42].map(domain => ({ ...BASELINE, domain })),
    ...[undefined, '', 'private-token', 42, '1', '2026-09-05', '2026-02-30T12:00:00Z'].map(capturedAt => ({ ...BASELINE, capturedAt })),
    ...[undefined, null, {}, []].map(records => ({ ...BASELINE, records })),
    ...[null, [], {},
      ...[undefined, '', '   ', 42].map(name => ({ name, type: 'TXT', values: [] })),
      ...[undefined, '', 'txt', 'NS', 16].map(type => ({ name: 'openings.dev', type, values: [] })),
      ...[undefined, null, {}, 'private-token', [42], ['private-token', null]].map(values => ({ name: 'openings.dev', type: 'TXT', values })),
    ].map(record => ({ ...BASELINE, records: [record] })),
  ];

  test.each(invalidBaselines.map((baseline, index) => ({ baseline, index })))(
    'rejects malformed evidence on either side with a generic error (case $index)', ({ baseline }) => {
      expect(() => compareDnsBaselines(baseline, BASELINE)).toThrow('Invalid DNS baseline');
      expect(() => compareDnsBaselines(BASELINE, baseline)).toThrow('Invalid DNS baseline');
      expect(() => compareDnsBaselines(baseline, baseline)).toThrow('Invalid DNS baseline');
    },
  );

  test.each(['openings.dev', 'OPENINGS.DEV'])('rejects duplicate query keys for %s', name => {
    const duplicate: DnsBaseline = {
      ...BASELINE,
      records: [...BASELINE.records, { name, type: 'TXT', values: ['private-token'] }],
    };
    expect(() => compareDnsBaselines(BASELINE, duplicate)).toThrow('Invalid DNS baseline');
    expect(() => compareDnsBaselines(duplicate, BASELINE)).toThrow('Invalid DNS baseline');
  });

  test('rejects invalid JSON at the CLI without exposing evidence contents', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dns-baseline-test-'));
    try {
      const path = join(directory, 'malformed.json');
      await writeFile(path, '{"private-token":invalid}');
      const result = spawnSync(process.execPath, ['scripts/compare-dns-baseline.ts', path, path], { encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Invalid DNS baseline JSON');
      expect(result.stderr).not.toContain('private-token');
      expect(result.stdout).toBe('');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test.each(['2026-09-05T12:00:00Z', '2026-09-05T09:00:00-03:00', '2024-02-29T00:00:00.000Z'])(
    'accepts a valid capture timestamp %s', capturedAt => {
      const baseline = { ...BASELINE, capturedAt };
      expect(compareDnsBaselines(baseline, baseline).safe).toBe(true);
    },
  );

  test.each([[], ['private-token']].map(values => ({ values })))('rejects mismatched query coverage even for empty answers: $values', ({ values }) => {
    const extra: DnsBaseline = {
      ...BASELINE,
      records: [...BASELINE.records, { name: 'www.openings.dev', type: 'A', values }],
    };
    expect(() => compareDnsBaselines(BASELINE, extra)).toThrow('DNS baselines are not comparable');
    expect(() => compareDnsBaselines(extra, BASELINE)).toThrow('DNS baselines are not comparable');
  });

  test('compares query coverage regardless of record order and name casing', () => {
    const after = { ...BASELINE, records: BASELINE.records.toReversed().map(record => ({ ...record, name: record.name.toUpperCase() })) };
    expect(compareDnsBaselines(BASELINE, after)).toEqual({ safe: true, protectedChanges: [], webChanges: [] });
  });

  test('rejects different query keys with the same record count', () => {
    const after = structuredClone(BASELINE);
    after.records[0] = { name: 'www.openings.dev', type: 'A', values: [] };
    expect(() => compareDnsBaselines(BASELINE, after)).toThrow('DNS baselines are not comparable');
  });

  test.each(['A', 'TXT'] as const)('compares explicit removal of %s answers', type => {
    const before: DnsBaseline = { ...BASELINE, records: [{ name: 'openings.dev', type, values: ['private-token'] }] };
    const after: DnsBaseline = { ...BASELINE, records: [{ name: 'openings.dev', type, values: [] }] };
    const result = compareDnsBaselines(before, after);
    expect(result.safe).toBe(type === 'A');
    expect(type === 'A' ? result.webChanges : result.protectedChanges).toEqual([
      { name: 'openings.dev', type, before: ['private-token'], after: [] },
    ]);
  });

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
