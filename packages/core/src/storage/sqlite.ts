import { createRequire } from 'module';
import type BetterSqlite3 from 'better-sqlite3';

const require = createRequire(import.meta.url);
const isBun = typeof process !== 'undefined' && process.versions && process.versions.bun;

let SqliteDbClass: any;
if (isBun) {
  const mod = require('bun' + ':sqlite');
  SqliteDbClass = mod.Database;
} else {
  SqliteDbClass = require('better' + '-sqlite3');
}

export const SqliteDatabase = SqliteDbClass;

export type SqliteDatabaseInstance = BetterSqlite3.Database;
