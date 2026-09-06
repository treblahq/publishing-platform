import type { PublicationEnvelope } from './publication-envelope.js';

import type { PublishingClient } from './client.js';
import type { FileOutbox, FileOutboxEntry } from './outbox.js';

export interface LocalProducerOptions {
  outbox: FileOutbox;
  client?: PublishingClient;
}

export interface DrainResult {
  attempted: number;
  accepted: number;
  deferred: number;
  failed: number;
  hasMore: boolean;
}

export interface LocalProducer {
  prepare(envelope: PublicationEnvelope): Promise<FileOutboxEntry>;
  drain(options: { limit: number }): Promise<DrainResult>;
}

export function createLocalProducer(options: LocalProducerOptions): LocalProducer {
  return {
    prepare: async (envelope) => options.outbox.enqueue(envelope),
    drain: async ({ limit }) => {
      if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
        throw new Error('Drain limit must be between 1 and 100');
      }
      if (!options.client) {
        throw new Error('Publishing client is required to drain the local outbox');
      }

      const entries = (await options.outbox.list()).slice(0, limit);
      let accepted = 0;
      let deferred = 0;
      let failed = 0;

      for (const entry of entries) {
        try {
          const result = await options.client.submit(entry.envelope);
          if (result.outcome === 'accepted') {
            await options.outbox.acknowledge(entry.id, result.publicationId);
            accepted += 1;
          } else {
            deferred += 1;
          }
        } catch {
          failed += 1;
        }
      }

      return {
        attempted: entries.length,
        accepted,
        deferred,
        failed,
        hasMore: (await options.outbox.list()).length > 0,
      };
    },
  };
}
