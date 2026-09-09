import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'CAA'] as const;

export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];

export interface DnsBaselineRecord {
  name: string;
  type: DnsRecordType;
  values: string[];
}

export interface DnsBaseline {
  schemaVersion: 1;
  domain: string;
  capturedAt: string;
  records: DnsBaselineRecord[];
}

interface DnsJsonAnswer { data: string }

const DNS_TYPE_CODES: Record<DnsRecordType, number> = { A: 1, AAAA: 28, CNAME: 5, MX: 15, TXT: 16, CAA: 257 };
const MAX_DNS_RESPONSE_BYTES = 256 * 1024;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatedAnswers(payload: unknown, type: DnsRecordType): DnsJsonAnswer[] {
  if (!isObject(payload) || (payload.Status !== 0 && payload.Status !== 3)) {
    throw new Error('DNS response has missing, invalid, or unsuccessful status');
  }
  if ('TC' in payload && payload.TC !== false) throw new Error('DNS response is truncated or has invalid TC');
  if (!('Answer' in payload)) return [];
  if (!Array.isArray(payload.Answer)) throw new Error('DNS response has invalid Answer');
  if (payload.Status === 3 && payload.Answer.length > 0) throw new Error('DNS NXDOMAIN response contains answers');
  const answers: DnsJsonAnswer[] = [];
  for (const entry of payload.Answer as unknown[]) {
    if (!isObject(entry) || typeof entry.type !== 'number' || !Number.isInteger(entry.type)
      || entry.type < 1 || entry.type > 65535 || typeof entry.data !== 'string') {
      throw new Error('DNS response has invalid answer entry');
    }
    if (entry.type === DNS_TYPE_CODES[type]) answers.push({ data: entry.data });
  }
  return answers;
}

async function readDnsResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('DNS response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DNS_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('DNS response exceeds 256 KiB');
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    // JSON parse errors can include opaque TXT values from the response body.
    throw new Error('DNS response contains invalid JSON');
  }
}

export function normalizeDnsAnswers(answers: DnsJsonAnswer[], type: DnsRecordType): string[] {
  return [...new Set(answers.map(({ data }) => type === 'TXT' || type === 'CAA'
    ? data
    : data.replace(/\.$/, '').toLowerCase()))].sort();
}

export async function queryDnsRecord(name: string, type: DnsRecordType): Promise<DnsBaselineRecord> {
  const url = new URL('https://cloudflare-dns.com/dns-query');
  url.searchParams.set('name', name);
  url.searchParams.set('type', type);
  const response = await fetch(url, {
    headers: { accept: 'application/dns-json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`DNS query failed for ${name} ${type}: HTTP ${String(response.status)}`);
  const payload = await readDnsResponse(response);
  return { name: name.toLowerCase(), type, values: normalizeDnsAnswers(validatedAnswers(payload, type), type) };
}

function defaultQueries(domain: string): Array<[string, DnsRecordType]> {
  return [
    ...DNS_RECORD_TYPES.map(type => [domain, type] as [string, DnsRecordType]),
    [`_dmarc.${domain}`, 'TXT'],
  ];
}

function parseQuery(value: string): [string, DnsRecordType] {
  const separator = value.lastIndexOf(':');
  const name = value.slice(0, separator).toLowerCase();
  const type = value.slice(separator + 1).toUpperCase() as DnsRecordType;
  if (!name || !DNS_RECORD_TYPES.includes(type)) throw new Error(`Invalid DNS query: ${value}`);
  return [name, type];
}

export async function captureDnsBaseline(domain: string, extraQueries: string[] = []): Promise<DnsBaseline> {
  const queries = [...new Map(
    [...defaultQueries(domain), ...extraQueries.map(parseQuery)]
      .map(query => [`${query[0].toLowerCase()}:${query[1]}`, query]),
  ).values()];
  const records = await Promise.all(queries.map(([name, type]) => queryDnsRecord(name, type)));
  records.sort((left, right) => `${left.name}:${left.type}`.localeCompare(`${right.name}:${right.type}`));
  return { schemaVersion: 1, domain: domain.toLowerCase(), capturedAt: new Date().toISOString(), records };
}

async function main(): Promise<void> {
  const [domain, output, ...extraQueries] = process.argv.slice(2);
  if (!domain || !output) throw new Error('Usage: capture-dns-baseline.ts <domain> <output.json> [name:type ...]');
  const baseline = await captureDnsBaseline(domain, extraQueries);
  await writeFile(output, `${JSON.stringify(baseline, null, 2)}\n`, { flag: 'wx' });
  const saved = JSON.parse(await readFile(output, 'utf8')) as DnsBaseline;
  if (saved.domain !== baseline.domain) throw new Error('DNS baseline verification failed');
  console.log(`Captured ${String(baseline.records.length)} DNS record sets for ${baseline.domain}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
