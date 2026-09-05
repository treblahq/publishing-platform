import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import type { DnsBaseline, DnsBaselineRecord, DnsRecordType } from './capture-dns-baseline.js';

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

export function compareDnsBaselines(before: DnsBaseline, after: DnsBaseline): {
  safe: boolean;
  protectedChanges: DnsChange[];
  webChanges: DnsChange[];
} {
  if (before.domain !== after.domain) {
    throw new Error('DNS baselines are not comparable');
  }
  const previous = new Map(before.records.map(record => [key(record), record]));
  const proposed = new Map(after.records.map(record => [key(record), record]));
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
    readFile(beforePath, 'utf8').then(value => JSON.parse(value) as DnsBaseline),
    readFile(afterPath, 'utf8').then(value => JSON.parse(value) as DnsBaseline),
  ]);
  const result = compareDnsBaselines(before, after);
  console.log(JSON.stringify(result, null, 2));
  if (!result.safe) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
