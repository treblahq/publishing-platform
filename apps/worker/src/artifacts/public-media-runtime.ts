import { createD1PublicMediaAdmission, type PublicMediaAdmissionCost } from '../capacity/d1-public-media-admission.js';
import { createD1PublicMediaResolver } from './d1-public-media-grants.js';
import { handlePublicMediaRequest, type MediaRange, type PublicMediaBody, type PublicMediaObject } from './public-media.js';

interface NativeMediaBucket {
  head(key: string): Promise<PublicMediaObject | null>;
  get(key: string, options?: { range: MediaRange }): Promise<PublicMediaBody | null>;
}

interface GatewayConfig {
  accountId: string;
  allowedAdapters: string[];
  cost: PublicMediaAdmissionCost;
}

export async function handleRuntimePublicMedia(request: Request, environment: Record<string, unknown>): Promise<Response> {
  try {
    const config = parseConfig(environment.PUBLIC_MEDIA_GATEWAY_CONFIG);
    if (config === 'disabled') return denied(404);
    if (!config || !hasMethods(environment.LEDGER, ['prepare']) || !hasMethods(environment.ARTIFACTS, ['head', 'get'])) return denied(503);
    const database = environment.LEDGER as Parameters<typeof createD1PublicMediaAdmission>[0]
      & Parameters<typeof createD1PublicMediaResolver>[0];
    const bucket = environment.ARTIFACTS as NativeMediaBucket;
    const now = () => new Date();
    return await handlePublicMediaRequest(request, {
      enabled: true, now,
      admit: createD1PublicMediaAdmission(database, config.accountId, config.cost, now),
      resolve: createD1PublicMediaResolver(database, config.allowedAdapters, now),
      bucket: {
        head: (key) => bucket.head(key),
        get: (key, range) => range ? bucket.get(key, { range }) : bucket.get(key),
      },
    });
  } catch { return denied(503); }
}

function parseConfig(value: unknown): GatewayConfig | 'disabled' | null {
  if (value === undefined) return 'disabled';
  if (typeof value !== 'string' || value.length > 4096) return null;
  const parsed: unknown = JSON.parse(value);
  if (!record(parsed)) return null;
  if (parsed.enabled === false) return 'disabled';
  if (parsed.enabled !== true || !exactKeys(parsed, ['enabled', 'accountId', 'allowedAdapters', 'cost'])) return null;
  const { accountId, allowedAdapters, cost } = parsed;
  if (typeof accountId !== 'string' || accountId.length !== 32 || !/^[a-f0-9]{32}$/u.test(accountId)
    || !Array.isArray(allowedAdapters) || allowedAdapters.length < 1 || allowedAdapters.length > 16
    || new Set(allowedAdapters).size !== allowedAdapters.length
    || !allowedAdapters.every((adapter): adapter is string => typeof adapter === 'string'
      && /^social\.[a-z0-9.-]{1,64}$/u.test(adapter) && adapter !== 'social.shadow')
    || !record(cost) || !exactKeys(cost, ['d1Reads', 'd1Writes', 'r2ClassB'])) return null;
  const { d1Reads, d1Writes, r2ClassB } = cost;
  if (typeof d1Reads !== 'number' || !Number.isSafeInteger(d1Reads) || d1Reads < 2
    || typeof d1Writes !== 'number' || !Number.isSafeInteger(d1Writes) || d1Writes < 1
    || typeof r2ClassB !== 'number' || !Number.isSafeInteger(r2ClassB) || r2ClassB < 2) return null;
  return { accountId, allowedAdapters, cost: { d1Reads, d1Writes, r2ClassB } };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function hasMethods(value: unknown, names: string[]): boolean {
  return record(value) && names.every((name) => typeof value[name] === 'function');
}

function denied(status: number): Response {
  return new Response(null, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
