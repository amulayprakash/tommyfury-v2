import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import config from '../src/nivabupa/config/env.js';

// Applies migrations/nivabupa/*.sql in filename order, once each.
// Usage: npm run nivabupa:migrate           (apply pending)
//        npm run nivabupa:migrate:status    (list without applying)
//        npm run nivabupa:migrate:verify    (dump the resulting schema)
//
// Separate from `prisma migrate` on purpose: these tables live in the NivaBupa
// database (policy_db — the host Laravel schema that owns the `users` table
// journeys attach to), not in tf-api's Prisma database, and one of them ALTERs a
// table Prisma does not model. Nothing here touches prisma/migrations.
//
// Uses its own connection rather than src/nivabupa/db's pool: the first
// migration CREATEs the database, so it must connect without selecting one, and
// it needs multipleStatements — which the runtime pool deliberately does not
// enable.

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(scriptDir, '..', 'migrations', 'nivabupa');

async function connect({ withDatabase }) {
  return mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    ...(withDatabase ? { database: config.db.database } : {}),
    multipleStatements: true,
    connectTimeout: config.db.connectTimeout,
  });
}

function migrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();
}

async function ensureDatabaseAndTracking() {
  // Bootstrap: the nivabupa_schema_migrations table lives inside the database the first
  // migration creates, so both have to exist before anything can be recorded.
  const bootstrap = await connect({ withDatabase: false });
  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\`
       DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await bootstrap.end();
  }

  const connection = await connect({ withDatabase: true });
  await connection.query(
    `CREATE TABLE IF NOT EXISTS nivabupa_schema_migrations (
       id INT UNSIGNED NOT NULL AUTO_INCREMENT,
       filename VARCHAR(255) NOT NULL,
       applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (id),
       UNIQUE KEY uk_nb_schema_migrations_filename (filename)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  return connection;
}

async function appliedFilenames(connection) {
  const [rows] = await connection.query('SELECT filename FROM nivabupa_schema_migrations');
  return new Set(rows.map((row) => row.filename));
}

async function status() {
  const connection = await ensureDatabaseAndTracking();
  try {
    const applied = await appliedFilenames(connection);
    console.log(`\nMigrations in ${config.db.database} @ ${config.db.host}:${config.db.port}\n`);
    for (const file of migrationFiles()) {
      console.log(`  ${applied.has(file) ? '✅ applied' : '⬜ pending'}  ${file}`);
    }
    console.log('');
  } finally {
    await connection.end();
  }
}

async function migrate() {
  const files = migrationFiles();
  if (files.length === 0) {
    console.log('No .sql files found in migrations/nivabupa/.');
    return;
  }

  const connection = await ensureDatabaseAndTracking();
  try {
    const applied = await appliedFilenames(connection);
    const pending = files.filter((file) => !applied.has(file));

    if (pending.length === 0) {
      console.log(`✅ Schema up to date — ${applied.size} migration(s) already applied.`);
      return;
    }

    console.log(`Applying ${pending.length} migration(s) to ${config.db.database}…\n`);

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      process.stdout.write(`  ▸ ${file} … `);
      try {
        // Not wrapped in a transaction: MySQL DDL is not transactional, so a
        // failed CREATE TABLE cannot be rolled back. Every statement in the
        // migration is IF NOT EXISTS / idempotent instead, so a partially
        // applied file can be re-run safely after the cause is fixed.
        await connection.query(sql);
        await connection.query('INSERT INTO nivabupa_schema_migrations (filename) VALUES (?)', [file]);
        console.log('done');
      } catch (error) {
        console.log('FAILED');
        console.error(`\n❌ ${file}: ${error.message}\n`);
        console.error('   Not recorded as applied. Fix the cause and re-run — the DDL is idempotent.');
        process.exitCode = 1;
        return;
      }
    }

    console.log('\n✅ Migrations applied.');
  } finally {
    await connection.end();
  }
}

async function verify() {
  const connection = await connect({ withDatabase: true });
  try {
    const [tables] = await connection.query(
      `SELECT TABLE_NAME AS name, TABLE_ROWS AS approx_rows
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
      [config.db.database]
    );
    const [fks] = await connection.query(
      `SELECT COUNT(*) AS total FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
      [config.db.database]
    );
    const [indexes] = await connection.query(
      `SELECT COUNT(DISTINCT TABLE_NAME, INDEX_NAME) AS total
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?`,
      [config.db.database]
    );

    console.log(`\n📋 ${config.db.database}: ${tables.length} tables, ${fks[0].total} foreign keys, ${indexes[0].total} indexes\n`);
    for (const table of tables) console.log(`   • ${table.name}`);
    console.log('');
  } finally {
    await connection.end();
  }
}

const arg = process.argv[2];
try {
  if (arg === '--status') await status();
  else if (arg === '--verify') await verify();
  else await migrate();
} catch (error) {
  console.error('\n❌ Migration runner failed:', error.message);
  if (error.code === 'ECONNREFUSED') {
    console.error(`   Nothing is listening on ${config.db.host}:${config.db.port}. Start MySQL and retry.`);
  }
  if (error.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error(`   Access denied for '${config.db.user}'. Check NIVABUPA_DB_USERNAME / NIVABUPA_DB_PASSWORD (or DB_USERNAME / DB_PASSWORD) in .env.`);
  }
  process.exit(1);
}
