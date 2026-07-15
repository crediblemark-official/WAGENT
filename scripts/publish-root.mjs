#!/usr/bin/env node
/**
 * Script publish khusus yang menghapus field workspaces & devDependencies
 * dari package.json sebelum publish ke NPM, lalu restore setelahnya.
 */
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';

const pkgPath = './package.json';
const bakPath = './package.json.bak';

const original = readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(original);

// Hapus field yang tidak relevan untuk consumers
const stripped = { ...pkg };
delete stripped.workspaces;
delete stripped.devDependencies;

// Tulis versi stripped
writeFileSync(bakPath, original);
writeFileSync(pkgPath, JSON.stringify(stripped, null, 2) + '\n');

console.log('📦 Publishing @wagent/wagent (workspaces field stripped)...');

try {
  execSync('npm publish --access public', { stdio: 'inherit' });
} finally {
  // Restore selalu
  writeFileSync(pkgPath, original);
  unlinkSync(bakPath);
  console.log('✅ package.json restored');
}
