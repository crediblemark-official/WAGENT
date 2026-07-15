import { createRequire } from 'module';
import type BetterSqlite3 from 'better-sqlite3';

const require = createRequire(import.meta.url);
const isBun = typeof process !== 'undefined' && process.versions && process.versions.bun;

export const SqliteDatabase: any = isBun
  ? require('bun:sqlite').Database
  : require('better-sqlite3');

export type SqliteDatabaseInstance = BetterSqlite3.Database;
