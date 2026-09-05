import { readFile } from 'node:fs/promises';

import {
  createFileOutbox,
  createLocalProducer,
  stagePlatformHandoff,
  type FileOutboxEntry,
  type PlatformHandoff,
} from '@treblahq/publishing-client';

export interface LocalStageArguments {
  inputPath: string;
  outboxDirectory: string;
}

export function parseLocalStageArguments(arguments_: string[]): LocalStageArguments {
  const inputPath = required(arguments_[0], 'handoff file');
  const outboxIndex = arguments_.indexOf('--outbox');
  if (outboxIndex < 0) throw new Error('An outbox directory is required');
  const outboxDirectory = required(arguments_[outboxIndex + 1], 'outbox directory');
  return { inputPath, outboxDirectory };
}

export async function stageHandoffFile(
  options: LocalStageArguments,
): Promise<FileOutboxEntry> {
  const value: unknown = JSON.parse(await readFile(options.inputPath, 'utf8'));
  const producer = createLocalProducer({
    outbox: createFileOutbox(options.outboxDirectory),
  });
  return stagePlatformHandoff(value as PlatformHandoff, producer);
}

function required(value: string | undefined, label: string): string {
  if (value === undefined || value.trim() === '' || value.startsWith('--')) {
    throw new Error(`A ${label} is required`);
  }
  return value.trim();
}
