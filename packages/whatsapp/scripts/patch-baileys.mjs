/**
 * Patch Baileys to use MACOS platform instead of WEB
 * 
 * WhatsApp servers reject Platform.WEB since Feb 2026, causing 405 errors.
 * This patch changes the platform to MACOS which WhatsApp accepts.
 * 
 * Reference: https://github.com/WhiskeySockets/Baileys/pull/2365
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BAILEYS_PATHS = [
  join(__dirname, '../../../node_modules/.bun/node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js'),
  join(__dirname, '../../../node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js'),
  join(__dirname, '../../../../node_modules/.bun/node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js'),
  join(__dirname, '../../../../node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js'),
];

function patchBaileys() {
  for (const path of BAILEYS_PATHS) {
    if (!existsSync(path)) continue;
    
    const content = readFileSync(path, 'utf-8');
    
    if (content.includes('Platform.MACOS')) {
      console.log('✓ Baileys already patched (MACOS platform)');
      return true;
    }
    
    const patched = content.replace(
      /platform:\s*WAProto_1\.proto\.ClientPayload\.UserAgent\.Platform\.WEB/,
      'platform: WAProto_1.proto.ClientPayload.UserAgent.Platform.MACOS'
    );
    
    if (patched !== content) {
      writeFileSync(path, patched, 'utf-8');
      console.log('✓ Baileys patched: Platform.WEB → Platform.MACOS');
      return true;
    }
  }
  
  console.log('⚠ Could not find Baileys to patch (405 fix not applied)');
  return false;
}

patchBaileys();
