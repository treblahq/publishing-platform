import { describe, expect, it, vi } from 'vitest';

import { cleanupArtifact, isArtifactDeletable, runBoundedCleanup } from './cleanup.js';

describe('artifact deletion safety', () => {
  it('allows deletion only when every remaining reference is safe', () => {
    expect(isArtifactDeletable([])).toBe(true);
    expect(isArtifactDeletable([{ safeToDelete: true }, { safeToDelete: true }])).toBe(true);
    expect(isArtifactDeletable([{ safeToDelete: true }, { safeToDelete: false }])).toBe(false);
  });

  it('persists a tombstone before deleting bytes', async () => {
    const order: string[] = [];
    await cleanupArtifact('artifact-1', {
      tombstone: () => { order.push('tombstone'); return Promise.resolve(); },
      deleteObject: () => { order.push('delete'); return Promise.resolve(); },
      markDeleted: () => { order.push('deleted'); return Promise.resolve(); },
    });
    expect(order).toEqual(['tombstone', 'delete', 'deleted']);
  });

  it('resumes safely if the process crashed after object deletion', async () => {
    let objectExists = true;
    const markDeleted = vi.fn().mockResolvedValue(undefined);
    const operations = {
      tombstone: vi.fn().mockResolvedValue(undefined),
      deleteObject: vi.fn().mockImplementation(() => {
        objectExists = false;
        return Promise.resolve();
      }),
      markDeleted,
    };
    await expect(cleanupArtifact('artifact-1', {
      ...operations,
      markDeleted: () => Promise.reject(new Error('crash')),
    })).rejects.toThrow('crash');
    expect(objectExists).toBe(false);
    await cleanupArtifact('artifact-1', operations);
    expect(markDeleted).toHaveBeenCalledOnce();
  });

  it('uses bounded batches with a persisted cursor', async () => {
    const visited: string[] = [];
    const result = await runBoundedCleanup(['one', 'two', 'three'], 2, (id) => {
      visited.push(id);
      return Promise.resolve();
    });
    expect(visited).toEqual(['one', 'two']);
    expect(result).toEqual({ processed: 2, cursor: 'two', hasMore: true });
  });
});
