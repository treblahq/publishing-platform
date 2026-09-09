// Read-only inventory, never an export or approval of public runtime behavior.
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { scanText } from './secret-scan.mjs';

const invalid = () => { throw new Error('PUBLIC_SNAPSHOT_MANIFEST_INVALID'); };
const rejected = () => { throw new Error('PUBLIC_SNAPSHOT_CONTENT_REJECTED'); };
const unavailable = () => { throw new Error('PUBLIC_SNAPSHOT_SOURCE_UNAVAILABLE'); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, expected) => record(value) && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const rootFiles = new Set(['package.json', 'package-lock.json', 'tsconfig.json', 'README.md', 'LICENSE']);
const sensitiveName = /(?:^\.env(?:\.|$)|^\.dev\.vars(?:\.|$)|credential|secret|private[-_]?key|\.(?:pem|key|p12|pfx)$)/iu;

function allowedPath(path) {
  if (typeof path !== 'string' || path.length > 240 || !/^[a-zA-Z0-9_./-]+$/u.test(path)) return false;
  const segments = path.split('/');
  if (segments.some(part => !part || part === '.' || part === '..' || sensitiveName.test(part)
    || /^(?:fixtures?|testdata|tests?|__tests__|__fixtures__|\.git|\.github)$/iu.test(part))) return false;
  if (/\.(?:test|spec)\./iu.test(path)) return false;
  return rootFiles.has(path) || /^(?:src|scripts)\/.+\.(?:ts|tsx|js|jsx|mjs|cjs|json)$/u.test(path);
}

function validate(manifest) {
  if (!exactKeys(manifest, ['schemaVersion', 'sourceCommit', 'files']) || manifest.schemaVersion !== 1
    || typeof manifest.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/u.test(manifest.sourceCommit)
    || !Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > 500) invalid();
  const seen = new Set();
  for (const entry of manifest.files) {
    if (!exactKeys(entry, ['path', 'sha256']) || !allowedPath(entry.path) || seen.has(entry.path)
      || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.sha256)) invalid();
    seen.add(entry.path);
  }
}

export function auditPublicSnapshot({ repositoryRoot, manifest }) {
  validate(manifest);
  if (typeof repositoryRoot !== 'string' || !repositoryRoot) invalid();
  const git = args => {
    try {
      return execFileSync('git', ['--no-lazy-fetch', '--literal-pathspecs', ...args], {
        cwd: repositoryRoot, timeout: 5000, maxBuffer: 2 * 1024 * 1024 + 1024,
        env: { PATH: process.env.PATH ?? '', LC_ALL: 'C', GIT_NO_REPLACE_OBJECTS: '1',
          GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '',
          GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch { return unavailable(); }
  };
  if (git(['rev-parse', '--verify', `${manifest.sourceCommit}^{commit}`]).toString().trim() !== manifest.sourceCommit) unavailable();
  let totalBytes = 0;
  const files = [];
  for (const entry of manifest.files) {
    const tree = git(['ls-tree', '-z', '--full-tree', manifest.sourceCommit, '--', entry.path]).toString('utf8');
    const match = /^(\d{6}) (\w+) ([a-f0-9]{40})\t([^\0]+)\0$/u.exec(tree);
    if (!match || match[4] !== entry.path) unavailable();
    if (!['100644', '100755'].includes(match[1]) || match[2] !== 'blob') rejected();
    const byteSize = Number(git(['cat-file', '-s', match[3]]).toString().trim());
    if (!Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > 2 * 1024 * 1024
      || totalBytes + byteSize > 16 * 1024 * 1024) rejected();
    const bytes = git(['cat-file', 'blob', match[3]]);
    const text = bytes.toString('utf8');
    if (bytes.length !== byteSize || bytes.includes(0) || !Buffer.from(text, 'utf8').equals(bytes)
      || createHash('sha256').update(bytes).digest('hex') !== entry.sha256 || scanText('source', text).length) rejected();
    files.push({ path: entry.path, sha256: entry.sha256, byteSize });
    totalBytes += byteSize;
  }
  return { sourceCommit: manifest.sourceCommit, scope: 'inventory-only', files, totalBytes };
}

export function readPublicSnapshotManifest(path) {
  let descriptor;
  try {
    // Nonblocking open permits checking/rejecting a FIFO without waiting for a writer.
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const metadata = fstatSync(descriptor);
    const maximum = 256 * 1024;
    if (!metadata.isFile() || metadata.size > maximum) invalid();
    const bytes = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, length);
      if (count === 0) break;
      length += count;
    }
    if (length > maximum) invalid();
    const manifest = JSON.parse(bytes.subarray(0, length).toString('utf8'));
    validate(manifest);
    return manifest;
  } catch { return invalid(); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [repositoryRoot, manifestPath, ...extra] = process.argv.slice(2);
    if (!repositoryRoot || !manifestPath || extra.length) invalid();
    const report = auditPublicSnapshot({ repositoryRoot, manifest: readPublicSnapshotManifest(manifestPath) });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch {
    // Never echo malformed manifest data, subprocess diagnostics or candidate code.
    process.stderr.write('Public snapshot inventory rejected. No export was performed.\n');
    process.exitCode = 1;
  }
}
