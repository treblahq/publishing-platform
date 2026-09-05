import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseLocalStageArguments, stageHandoffFile } from './local-stage.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('local handoff staging', () => {
  it('parses an explicit input and outbox without environment credentials', () => {
    expect(
      parseLocalStageArguments(['handoff.json', '--outbox', '.publishing/outbox']),
    ).toEqual({ inputPath: 'handoff.json', outboxDirectory: '.publishing/outbox' });
    expect(() => parseLocalStageArguments(['handoff.json'])).toThrow(
      'outbox directory',
    );
  });

  it('validates and durably queues an envelope without network access', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'publishing-cli-stage-'));
    directories.push(directory);
    const inputPath = join(directory, 'handoff.json');
    const outboxDirectory = join(directory, 'outbox');
    await writeFile(
      inputPath,
      JSON.stringify({
        envelope: {
          schemaVersion: 1,
          identity: {
            tenant: 'openings',
            sourceType: 'job',
            sourceId: 'gh_1',
            revision: 'rev-1',
            idempotencyKey: 'openings:job:gh_1:rev-1',
          },
          canonical: { title: 'Senior Engineer', language: 'pt-BR' },
          artifacts: [],
          deliveries: [
            {
              id: 'social-shadow',
              adapter: 'social.shadow',
              operation: 'compare',
              required: false,
              payload: { type: 'social.post', text: 'Senior Engineer' },
            },
          ],
        },
        uploads: [],
      }),
    );

    const result = await stageHandoffFile({ inputPath, outboxDirectory });

    expect(result.path.startsWith(outboxDirectory)).toBe(true);
    expect(await readFile(result.path, 'utf8')).toContain(
      'openings:job:gh_1:rev-1',
    );
  });
});
