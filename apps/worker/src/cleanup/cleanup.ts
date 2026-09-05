export interface ArtifactReferenceState {
  safeToDelete: boolean;
}

export interface CleanupOperations {
  tombstone(artifactId: string): Promise<void>;
  deleteObject(artifactId: string): Promise<void>;
  markDeleted(artifactId: string): Promise<void>;
}

export function isArtifactDeletable(references: readonly ArtifactReferenceState[]): boolean {
  return references.every((reference) => reference.safeToDelete);
}

export async function cleanupArtifact(
  artifactId: string,
  operations: CleanupOperations,
): Promise<void> {
  await operations.tombstone(artifactId);
  await operations.deleteObject(artifactId);
  await operations.markDeleted(artifactId);
}

export async function runBoundedCleanup<T extends string>(
  candidates: readonly T[],
  batchSize: number,
  cleanup: (candidate: T) => Promise<void>,
): Promise<{ processed: number; cursor: T | undefined; hasMore: boolean }> {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new Error('Cleanup batch size must be a positive integer');
  }
  const batch = candidates.slice(0, batchSize);
  for (const candidate of batch) await cleanup(candidate);
  return {
    processed: batch.length,
    cursor: batch.at(-1),
    hasMore: candidates.length > batch.length,
  };
}
