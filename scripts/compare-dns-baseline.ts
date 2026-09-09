import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import type { DnsBaseline, DnsBaselineRecord, DnsRecordType } from './capture-dns-baseline.js';

const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'CAA'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCaptureTimestamp(value: unknown): boolean {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) return false;
  const date = value.slice(0, 10);
  return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

function validateBaseline(value: unknown): asserts value is DnsBaseline {
  if (!isObject(value) || value.schemaVersion !== 1
    || typeof value.domain !== 'string' || !value.domain.trim()
    || !isCaptureTimestamp(value.capturedAt)
    || !Array.isArray(value.records) || value.records.length === 0) {
    throw new Error('Invalid DNS baseline');
  }
  const keys = new Set<string>();
  for (const record of value.records as unknown[]) {
    if (!isObject(record) || typeof record.name !== 'string' || !record.name.trim()
      || typeof record.type !== 'string' || !DNS_RECORD_TYPES.includes(record.type)
      || !Array.isArray(record.values) || !record.values.every(answer => typeof answer === 'string')) {
      throw new Error('Invalid DNS baseline');
    }
    const recordKey = `${record.name.toLowerCase()}:${record.type}`;
    if (keys.has(recordKey)) throw new Error('Invalid DNS baseline');
    keys.add(recordKey);
  }
}

export interface DnsChange {
  name: string;
  type: DnsRecordType;
  before: string[];
  after: string[];
}

function key(record: Pick<DnsBaselineRecord, 'name' | 'type'>): string {
  return `${record.name.toLowerCase()}:${record.type}`;
}

function isWebRecord(record: Pick<DnsBaselineRecord, 'name' | 'type'>, domain: string): boolean {
  const webNames = new Set([domain, `www.${domain}`]);
  return webNames.has(record.name.toLowerCase()) && ['A', 'AAAA', 'CNAME'].includes(record.type);
}

export function compareDnsBaselines(before: unknown, after: unknown): {
  safe: boolean;
  protectedChanges: DnsChange[];
  webChanges: DnsChange[];
} {
  validateBaseline(before);
  validateBaseline(after);
  if (before.domain !== after.domain) {
    throw new Error('DNS baselines are not comparable');
  }
  const previous = new Map(before.records.map(record => [key(record), record]));
  const proposed = new Map(after.records.map(record => [key(record), record]));
  if (previous.size !== proposed.size || [...previous.keys()].some(recordKey => !proposed.has(recordKey))) {
    throw new Error('DNS baselines are not comparable');
  }
  const changes: DnsChange[] = [];
  for (const recordKey of [...new Set([...previous.keys(), ...proposed.keys()])].sort()) {
    const left = previous.get(recordKey);
    const right = proposed.get(recordKey);
    const beforeValues = left?.values ?? [];
    const afterValues = right?.values ?? [];
    if (JSON.stringify(beforeValues) === JSON.stringify(afterValues)) continue;
    const record = right ?? left;
    if (!record) continue;
    changes.push({ name: record.name, type: record.type, before: beforeValues, after: afterValues });
  }
  const webChanges = changes.filter(change => isWebRecord(change, before.domain));
  const protectedChanges = changes.filter(change => !isWebRecord(change, before.domain));
  return { safe: protectedChanges.length === 0, protectedChanges, webChanges };
}

async function main(): Promise<void> {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) throw new Error('Usage: compare-dns-baseline.ts <before.json> <after.json>');
  const [before, after] = await Promise.all([
    readBaseline(beforePath),
    readBaseline(afterPath),
  ]);
  const result = compareDnsBaselines(before, after);
  console.log(JSON.stringify(result, null, 2));
  if (!result.safe) process.exitCode = 2;
}

async function readBaseline(path: string): Promise<unknown> {
  const contents = await readFile(path, 'utf8');
  try {
    return JSON.parse(contents) as unknown;
  } catch {
    throw new Error('Invalid DNS baseline JSON');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
