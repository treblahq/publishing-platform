import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function hydrateStagingConfig(config, environment = process.env, configDirectory = process.cwd()) {
  const databaseId = environment.CLOUDFLARE_D1_DATABASE_ID;
  if (typeof databaseId !== 'string' || !UUID.test(databaseId)) {
    throw new Error('CLOUDFLARE_D1_DATABASE_ID must be a valid UUID');
  }

  const hydrated = JSON.parse(JSON.stringify(config));
  const database = hydrated?.env?.staging?.d1_databases?.[0];
  if (!database) throw new Error('Staging D1 binding is missing');
  database.database_id = databaseId;
  database.migrations_dir = resolve(configDirectory, database.migrations_dir ?? 'migrations');
  return hydrated;
}

async function main() {
  const [source = 'apps/worker/wrangler.json', destination] = process.argv.slice(2);
  if (!destination) throw new Error('Destination path is required');
  const config = JSON.parse(await readFile(source, 'utf8'));
  const hydrated = hydrateStagingConfig(config, process.env, dirname(resolve(source)));
  await writeFile(destination, `${JSON.stringify(hydrated, null, 2)}\n`, { flag: 'wx' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
