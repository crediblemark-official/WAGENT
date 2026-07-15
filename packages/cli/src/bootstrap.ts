import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function patchBaileys() {
  let resolvedBaileysPath = '';
  try {
    const entryPoint = require.resolve('@whiskeysockets/baileys');
    resolvedBaileysPath = join(dirname(entryPoint), 'Utils/validate-connection.js');
  } catch (e) {
    // Fallback
  }

  const paths = [
    resolvedBaileysPath,
    join(__dirname, '../node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js'),
    join(__dirname, '../../node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js'),
    join(__dirname, '../../../node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js'),
  ].filter(Boolean);

  for (const path of paths) {
    if (!path || !existsSync(path)) continue;
    try {
      const content = readFileSync(path, 'utf-8');
      if (content.includes('Platform.MACOS')) {
        break; // Sudah di-patch
      }
      const patched = content.replace(
        /platform:\s*((?:[A-Za-z0-9_]+\.)?proto\.ClientPayload\.UserAgent\.Platform\.)WEB/,
        'platform: $1MACOS'
      );
      if (patched !== content) {
        writeFileSync(path, patched, 'utf-8');
        break;
      }
    } catch (err) {
      // Abaikan jika gagal (misal permission write)
    }
  }
}

// Jalankan patch secara synchronous sebelum load index.js yang melakukan static import
patchBaileys();

// Jalankan entrypoint index.ts
import('./index.js');
