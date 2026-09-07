import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createPublishingClient, type PublishingClientOptions, type SubmissionResult } from './client.js';
import { createArtifactUploader } from './upload.js';
import { createFileOutbox } from './outbox.js';
import { sha256Hex } from './headers.js';
import { stagePlatformHandoff, uploadPlatformHandoff, type PlatformHandoff, type PlatformUploadOutcome } from './handoff.js';

export interface PlatformPublisherOptions {
  outboxDirectory: string;
  transport?: PublishingClientOptions;
}

export interface PreparedPlatformHandoff { id: string; path: string }
export type PlatformSubmissionOutcome = SubmissionResult
  | Extract<PlatformUploadOutcome, { outcome: 'retry-later' }>
  | { outcome: 'already-accepted'; publicationId: string };

export interface PlatformPublisher {
  prepare<T>(handoff: PlatformHandoff<T>): Promise<PreparedPlatformHandoff>;
  submit<T>(handoff: PlatformHandoff<T>): Promise<PlatformSubmissionOutcome>;
}

/** One durable handoff at a time; never drain unrelated, unuploaded publications. */
export function createPlatformPublisher(options: PlatformPublisherOptions): PlatformPublisher {
  const root = resolve(options.outboxDirectory);

  async function prepare<T>(handoff: PlatformHandoff<T>) {
    // Validate all bindings before touching persistent state or a transport.
    const validated = await stagePlatformHandoff(handoff, {
      prepare: async envelope => ({ id: await sha256Hex(envelope.identity.idempotencyKey), path: '', envelope }),
    });
    const directory = join(root, validated.id);
    const path = join(directory, 'handoff.json');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `${crypto.randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(handoff)}\n`, { flag: 'wx', mode: 0o600 });
    try {
      // Atomically install complete bytes without overwriting a concurrent writer.
      await link(temporary, path).catch((error: unknown) => { if (!hasCode(error, 'EEXIST')) throw error; });
    } finally {
      await unlink(temporary);
    }
    const saved = JSON.parse(await readFile(path, 'utf8')) as PlatformHandoff;
    if (JSON.stringify(saved.envelope) !== JSON.stringify(validated.envelope)) {
      throw new Error('Publication identity already has different content');
    }
    const accepted = await readAcceptance(directory, validated.id);
    if (!accepted) await createFileOutbox(directory).enqueue(validated.envelope);
    return { id: validated.id, path, directory, envelope: validated.envelope, accepted };
  }

  return {
    async prepare(handoff) {
      const { id, path } = await prepare(handoff);
      return { id, path };
    },
    async submit(handoff) {
      const transport = options.transport;
      if (!transport?.baseUrl || !transport.clientId.trim() || !transport.secret.trim()) {
        throw new Error('Publishing endpoint and credentials are required');
      }
      const url = new URL(transport.baseUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw new Error('Publishing endpoint must be a plain HTTPS origin');
      }
      const prepared = await prepare(handoff);
      if (prepared.accepted) return { outcome: 'already-accepted', publicationId: prepared.accepted };
      const boundedTransport = { ...transport, fetch: ((url, init) => (transport.fetch ?? globalThis.fetch)(url, {
        ...init, redirect: 'error', signal: AbortSignal.timeout(60_000),
      })) as typeof fetch };
      const upload = await uploadPlatformHandoff(handoff, createArtifactUploader(boundedTransport));
      if (upload.outcome !== 'available') return upload;
      const result = await createPublishingClient(boundedTransport).submit(prepared.envelope);
      if (result.outcome === 'accepted') {
        await createFileOutbox(prepared.directory).acknowledge(prepared.id, result.publicationId);
      }
      return result;
    },
  };
}

async function readAcceptance(directory: string, id: string): Promise<string | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(join(directory, 'accepted', `${id}.json`), 'utf8'));
    if (!value || typeof value !== 'object' || !('publicationId' in value)
      || typeof value.publicationId !== 'string' || !value.publicationId.trim()) {
      throw new Error('Invalid acceptance receipt');
    }
    return value.publicationId;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === code;
}
