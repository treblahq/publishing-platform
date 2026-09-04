import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  validatePublicationEnvelope,
  type PublicationEnvelope,
} from '@treblahq/publishing-contracts';

import { sha256Hex } from './headers.js';

export interface FileOutboxEntry {
  id: string;
  path: string;
  envelope: PublicationEnvelope;
}

export interface FileOutbox {
  enqueue(envelope: PublicationEnvelope): Promise<FileOutboxEntry>;
  list(): Promise<FileOutboxEntry[]>;
  acknowledge(id: string, publicationId: string): Promise<void>;
}

export function createFileOutbox(directory: string): FileOutbox {
  const acceptedDirectory = join(directory, 'accepted');

  return {
    async enqueue(envelope): Promise<FileOutboxEntry> {
      validatePublicationEnvelope(envelope);
      await mkdir(directory, { recursive: true });
      const id = await sha256Hex(envelope.identity.idempotencyKey);
      const path = join(directory, `${id}.json`);
      const temporaryPath = join(directory, `${id}.${crypto.randomUUID()}.tmp`);
      await writeFile(temporaryPath, `${JSON.stringify(envelope)}\n`, { encoding: 'utf8', flag: 'wx' });
      await rename(temporaryPath, path);
      return { id, path, envelope };
    },

    async list(): Promise<FileOutboxEntry[]> {
      await mkdir(directory, { recursive: true });
      const names = (await readdir(directory))
        .filter((name) => /^[a-f0-9]{64}\.json$/u.test(name))
        .sort();
      return Promise.all(names.map(async (name) => {
        const path = join(directory, name);
        const value: unknown = JSON.parse(await readFile(path, 'utf8'));
        const envelope = validatePublicationEnvelope(value);
        return { id: name.slice(0, -5), path, envelope };
      }));
    },

    async acknowledge(id, publicationId): Promise<void> {
      if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error('Invalid outbox entry ID');
      if (publicationId.length === 0) throw new Error('Publication ID is required');
      await mkdir(acceptedDirectory, { recursive: true });
      const acceptedPath = join(acceptedDirectory, `${id}.json`);
      const temporaryPath = join(acceptedDirectory, `${id}.${crypto.randomUUID()}.tmp`);
      await writeFile(temporaryPath, `${JSON.stringify({ publicationId })}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      await rename(temporaryPath, acceptedPath);
      await unlink(join(directory, `${id}.json`));
    },
  };
}
