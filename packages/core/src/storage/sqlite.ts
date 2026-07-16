import { createRequire } from 'module';
import type BetterSqlite3 from 'better-sqlite3';

const require = createRequire(import.meta.url);
const isBun = typeof process !== 'undefined' && process.versions && process.versions.bun;

// ── Engine resolution (Bun → better-sqlite3 → node:sqlite fallback) ──
// Resolved once at module load. Falls back gracefully so the app still
// boots on platforms where better-sqlite3 cannot be compiled (e.g. Termux
// without a C++ toolchain) — provided Node ≥ 22.5 is available.
let SqliteDbClass: any;
let engineName = 'better-sqlite3';

if (isBun) {
  const mod = require('bun' + ':sqlite');
  SqliteDbClass = mod.Database;
  engineName = 'bun:sqlite';
} else {
  try {
    SqliteDbClass = require('better' + '-sqlite3');
    engineName = 'better-sqlite3';
  } catch (betterErr: any) {
    // better-sqlite3 failed to load (missing native build). Try the built-in
    // node:sqlite (Node ≥ 22.5). Note: on some Node versions it requires the
    // --experimental-sqlite flag; we surface a clear hint if it is unavailable.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nodeSqlite = require('node:sqlite');
      const NodeDatabase = (nodeSqlite as any).DatabaseSync ?? (nodeSqlite as any).Database;
      if (typeof NodeDatabase !== 'function') {
        throw new Error('node:sqlite Database class not exposed (need Node ≥ 22.5 with --experimental-sqlite)');
      }
      SqliteDbClass = NodeDatabase;
      engineName = 'node:sqlite';
    } catch (nodeErr: any) {
      const getLogger = (await import('../utils/logger.js')).getLogger;
      getLogger().error(
        { better: betterErr.message, node: nodeErr.message },
        'SQLite engine unavailable. On Termux/Android install a toolchain (pkg install build-essential python) so better-sqlite3 can compile, or run WAGENT with Bun (bun:sqlite).',
      );
      throw betterErr;
    }
  }
}

export const SqliteDatabase = SqliteDbClass;
export const SQLITE_ENGINE = engineName;

export type SqliteDatabaseInstance = BetterSqlite3.Database;
