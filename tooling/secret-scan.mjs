import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const SECRET_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{40,255}\b/u,
  /\bsk-[A-Za-z0-9]{20,}\b/u,
  /\bAKIA[A-Z0-9]{16}\b/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
];

export function scanText(path, text) {
  return text.split(/\r?\n/u).flatMap((line, index) =>
    SECRET_PATTERNS.some((pattern) => pattern.test(line)) ? [`${path}:${String(index + 1)}`] : [],
  );
}

export function scanRepository() {
  const paths = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean);
  return paths.flatMap((path) => {
    const bytes = readFileSync(path);
    return bytes.includes(0) ? [] : scanText(path, bytes.toString('utf8'));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = scanRepository();
  if (findings.length > 0) {
    process.stderr.write(`Potential secrets detected:\n${findings.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Repository secret scan passed.\n');
  }
}
