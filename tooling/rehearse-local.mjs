import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const configPath = resolve(repositoryRoot, 'apps/worker/wrangler.json');
const wranglerPath = resolve(repositoryRoot, 'node_modules/wrangler/bin/wrangler.js');

export function buildLocalRehearsalSteps(stateDirectory) {
  const local = [
    '--local',
    '--config',
    configPath,
    '--persist-to',
    stateDirectory,
  ];

  return [
    [
      'd1',
      'migrations',
      'apply',
      'publishing-platform-local',
      ...local,
    ],
    [
      'd1',
      'execute',
      'publishing-platform-local',
      ...local,
      '--command',
      'SELECT (SELECT COUNT(*) FROM publications) + (SELECT COUNT(*) FROM deliveries) + (SELECT COUNT(*) FROM artifacts) + (SELECT COUNT(*) FROM capacity_usage) + (SELECT COUNT(*) FROM web_entity_manifests) + (SELECT COUNT(*) FROM artifact_uploads) AS total_rows;',
    ],
  ];
}

async function main() {
  const stateDirectory = await mkdtemp(
    resolve(tmpdir(), 'publishing-platform-local-'),
  );
  process.stdout.write(`Disposable local state: ${stateDirectory}\n`);

  for (const args of buildLocalRehearsalSteps(stateDirectory)) {
    const result = spawnSync(process.execPath, [wranglerPath, ...args], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: resolve(stateDirectory, 'wrangler.log'),
      },
      stdio: 'inherit',
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
