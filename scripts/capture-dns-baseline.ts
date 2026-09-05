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
interface DnsJsonResponse { Answer?: DnsJsonAnswer[] }

export function normalizeDnsAnswers(answers: DnsJsonAnswer[]): string[] {
  return [...new Set(answers.map(({ data }) => data
    .replace(/"\s+"/g, '')
    .replaceAll('"', '')
    .replace(/\.$/, '')
    .toLowerCase()))].sort();
}

export async function queryDnsRecord(name: string, type: DnsRecordType): Promise<DnsBaselineRecord> {
  const url = new URL('https://cloudflare-dns.com/dns-query');
  url.searchParams.set('name', name);
  url.searchParams.set('type', type);
  const response = await fetch(url, { headers: { accept: 'application/dns-json' } });
  if (!response.ok) throw new Error(`DNS query failed for ${name} ${type}: HTTP ${String(response.status)}`);
  const payload: DnsJsonResponse = await response.json();
  return { name: name.toLowerCase(), type, values: normalizeDnsAnswers(payload.Answer ?? []) };
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
  const queries = [...defaultQueries(domain), ...extraQueries.map(parseQuery)];
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
