// The development databases of the backend (apps/server): `tramme` and
// `tramme_test`, created in the Postgres you already run (Laragon's, on 5432).
//
//   npm run db:dev
//
// The server's own address is PGADMIN_URL (default: the `postgres` user of
// 127.0.0.1:5432, no password, as Laragon sets it up). Nothing is dropped, and
// a database that exists is left as it is. With no Postgres at all:
//   docker compose -f docker-compose.dev.yml up -d

import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// `pg` is a dependency of the backend
const { Client } = createRequire(resolve(import.meta.dirname, '..', 'apps', 'server', 'package.json'))('pg') as typeof import('pg');

const url = process.env.PGADMIN_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres';
const client = new Client({ connectionString: url });

try {
  await client.connect();
} catch (error) {
  console.error(`No Postgres answers at ${url.replace(/:[^:@/]*@/, ':***@')}: start it (Laragon), set PGADMIN_URL, or use docker-compose.dev.yml.\n${(error as Error).message}`);
  process.exit(1);
}

for (const name of ['tramme', 'tramme_test']) {
  const exists = await client.query('select 1 from pg_database where datname = $1', [name]);
  if (exists.rowCount) { console.log(`${name}: already there`); continue; }
  await client.query(`create database ${name}`);
  console.log(`${name}: created`);
}
await client.end();
