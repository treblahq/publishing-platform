import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditPublicSnapshot, readPublicSnapshotManifest } from './audit-public-snapshot.mjs';

const directories = [];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(extra = {}) {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'public-snapshot-'));
  directories.push(repositoryRoot);
  const git = args => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']);
  for (const [path, content] of Object.entries({ 'src/safe.ts': 'export const answer = 42;\n', 'content/private.json': '{"fixture":"not for export"}', ...extra })) {
    mkdirSync(dirname(join(repositoryRoot, path)), { recursive: true });
    writeFileSync(join(repositoryRoot, path), content);
  }
  const commit = () => { git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']); return git(['rev-parse', 'HEAD']); };
  const sourceCommit = commit();
  const entry = path => ({ path, sha256: digest(readFileSync(join(repositoryRoot, path))) });
  return { repositoryRoot, git, commit, entry, manifest: { schemaVersion: 1, sourceCommit, files: [entry('src/safe.ts')] } };
}
afterEach(() => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('exact public source inventory', () => {
  it('reads only a bounded regular manifest and rejects a FIFO without blocking', () => {
    const input = fixture();
    const path = join(input.repositoryRoot, 'manifest.json');
    writeFileSync(path, JSON.stringify(input.manifest));
    expect(readPublicSnapshotManifest(path)).toEqual(input.manifest);
    writeFileSync(path, ' '.repeat(256 * 1024 + 1));
    expect(() => readPublicSnapshotManifest(path)).toThrow('PUBLIC_SNAPSHOT_MANIFEST_INVALID');
    const fifo = join(input.repositoryRoot, 'manifest-pipe');
    execFileSync('mkfifo', [fifo]);
    expect(() => readPublicSnapshotManifest(fifo)).toThrow('PUBLIC_SNAPSHOT_MANIFEST_INVALID');
    const link = join(input.repositoryRoot, 'manifest-link');
    symlinkSync('manifest.json', link);
    expect(() => readPublicSnapshotManifest(link)).toThrow('PUBLIC_SNAPSHOT_MANIFEST_INVALID');
    expect(() => readPublicSnapshotManifest(input.repositoryRoot)).toThrow('PUBLIC_SNAPSHOT_MANIFEST_INVALID');
  });

  it('does not let inherited Git variables select another repository', () => {
    const first = fixture();
    const second = fixture({ 'src/safe.ts': 'export const other = 77;' });
    vi.stubEnv('GIT_DIR', join(second.repositoryRoot, '.git'));
    vi.stubEnv('GIT_WORK_TREE', second.repositoryRoot);
    expect(() => auditPublicSnapshot({ repositoryRoot: first.repositoryRoot, manifest: second.manifest })).toThrow('PUBLIC_SNAPSHOT_SOURCE_UNAVAILABLE');
  });

  it('does not lazily fetch missing promised blobs or invoke a remote helper', () => {
    const input = fixture();
    const blob = input.git(['rev-parse', `${input.manifest.sourceCommit}:src/safe.ts`]);
    const marker = join(input.repositoryRoot, 'remote-helper-invoked');
    const helper = join(input.repositoryRoot, 'remote-helper');
    writeFileSync(helper, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o700 });
    input.git(['config', 'remote.origin.url', `ext::${helper}`]);
    input.git(['config', 'remote.origin.promisor', 'true']);
    input.git(['config', 'remote.origin.partialclonefilter', 'blob:none']);
    input.git(['config', 'extensions.partialClone', 'origin']);
    input.git(['config', 'protocol.ext.allow', 'always']);
    rmSync(join(input.repositoryRoot, '.git/objects', blob.slice(0, 2), blob.slice(2)));
    expect(() => auditPublicSnapshot(input)).toThrow('PUBLIC_SNAPSHOT_SOURCE_UNAVAILABLE');
    expect(existsSync(marker)).toBe(false);
  });

  it('reports only selected committed bytes without copying private files or touching dirty work', () => {
    const input = fixture();
    writeFileSync(join(input.repositoryRoot, 'src/safe.ts'), 'uncommitted user work');
    const before = input.git(['status', '--porcelain']);
    const report = auditPublicSnapshot(input);
    expect(report).toEqual({ sourceCommit: input.manifest.sourceCommit, scope: 'inventory-only', totalBytes: 26,
      files: [{ ...input.manifest.files[0], byteSize: 26 }] });
    expect(JSON.stringify(report)).not.toContain('private');
    expect(input.git(['status', '--porcelain'])).toBe(before);
    expect(readFileSync(join(input.repositoryRoot, 'src/safe.ts'), 'utf8')).toBe('uncommitted user work');
  });

  it.each(['../src/safe.ts', '/src/safe.ts', 'src\\safe.ts', 'src/*.ts', 'src/./safe.ts', 'src/a\n.ts',
    'content/private.json', 'assets/art.ts', 'config/runtime.json', 'docs/README.md', '.github/workflows/publish.yml',
    'src/safe.test.ts', 'src/fixtures/data.json', 'src/.env', 'src/credentials.json', 'scripts/private-key.ts'])('rejects disallowed path %s before reading content', path => {
    const input = fixture();
    input.manifest.files[0].path = path;
    expect(() => auditPublicSnapshot(input)).toThrow('PUBLIC_SNAPSHOT_MANIFEST_INVALID');
  });

  it.each(['empty', 'duplicate', 'extra', 'too-many', 'bad-commit'])('rejects %s manifests', kind => {
    const input = fixture();
    if (kind === 'empty') input.manifest.files = [];
    if (kind === 'duplicate') input.manifest.files.push(input.manifest.files[0]);
    if (kind === 'extra') input.manifest.approved = true;
    if (kind === 'too-many') input.manifest.files = Array.from({ length: 501 }, (_, index) => ({ path: `src/${index}.ts`, sha256: 'a'.repeat(64) }));
    if (kind === 'bad-commit') input.manifest.sourceCommit = '--all';
    expect(() => auditPublicSnapshot(input)).toThrow('PUBLIC_SNAPSHOT_MANIFEST_INVALID');
  });

  it('rejects altered approval hashes and missing paths or commits', () => {
    const input = fixture();
    input.manifest.files[0].sha256 = 'f'.repeat(64);
    expect(() => auditPublicSnapshot(input)).toThrow('PUBLIC_SNAPSHOT_CONTENT_REJECTED');
    input.manifest.files[0].path = 'src/missing.ts';
    expect(() => auditPublicSnapshot(input)).toThrow('PUBLIC_SNAPSHOT_SOURCE_UNAVAILABLE');
    input.manifest.sourceCommit = '0'.repeat(40);
    expect(() => auditPublicSnapshot(input)).toThrow('PUBLIC_SNAPSHOT_SOURCE_UNAVAILABLE');
  });

  it('rejects a committed symlink even when its target is allowed', () => {
    const input = fixture();
    symlinkSync('safe.ts', join(input.repositoryRoot, 'src/link.ts'));
    input.manifest.sourceCommit = input.commit();
    input.manifest.files = [{ path: 'src/link.ts', sha256: digest('safe.ts') }];
    expect(() => auditPublicSnapshot(input)).toThrow('PUBLIC_SNAPSHOT_CONTENT_REJECTED');
  });

  it.each(['binary', 'invalid-utf8', 'oversize', 'credential'])('rejects %s source without including contents in errors', kind => {
    const secret = 'gh' + 'p_' + 'a'.repeat(36);
    const content = kind === 'binary' ? Buffer.from([65, 0, 66]) : kind === 'invalid-utf8' ? Buffer.from([255, 254])
      : kind === 'oversize' ? 'a'.repeat(2 * 1024 * 1024 + 1) : `export const value = '${secret}';`;
    const input = fixture({ 'src/suspect.ts': content });
    input.manifest.files = [input.entry('src/suspect.ts')];
    expect(() => auditPublicSnapshot(input)).toThrow('PUBLIC_SNAPSHOT_CONTENT_REJECTED');
    try { auditPublicSnapshot(input); } catch (error) { expect(String(error)).not.toContain(secret); }
  });
});
