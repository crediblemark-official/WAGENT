import { writeFileSync, existsSync, readdirSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import color from 'picocolors';
import { WhatsAppNumberConfig } from '@wagent/core';

const NUMBERS_FILE = join(process.cwd(), 'data', 'numbers.json');

function loadNumbers(): WhatsAppNumberConfig[] {
  if (!existsSync(NUMBERS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(NUMBERS_FILE, 'utf-8'));
  } catch { return []; }
}

function saveNumbers(numbers: WhatsAppNumberConfig[]): void {
  const dir = join(process.cwd(), 'data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(NUMBERS_FILE, JSON.stringify(numbers, null, 2));
}

export function listNumbers(): void {
  const numbers = loadNumbers();
  const sessionDir = join(process.cwd(), '.sessions');

  console.log('');
  console.log(color.bold('📱 Multi-Number Configuration'));
  console.log('────────────────────────────────────');

  if (numbers.length === 0) {
    console.log(color.dim('  Belum ada nomor. Tambah dengan: wagent number add <id> <sessionName>'));
    console.log('');
    return;
  }

  for (const n of numbers) {
    const sessionPath = join(sessionDir, n.sessionName);
    const hasSession = existsSync(sessionPath);
    const hasCreds = hasSession && readdirSync(sessionPath).some(f => f.includes('creds'));

    const statusColor = hasCreds ? color.green : hasSession ? color.yellow : color.dim;
    const statusText = hasCreds ? '✅ Siap (pernah login)' : hasSession ? '⚠️  Session ada, belum login' : '❌ Belum ada session';

    console.log(`  ${color.cyan(n.id)}`);
    console.log(`    Label       : ${n.label || color.dim('(none)')}`);
    console.log(`    Session     : ${n.sessionName}`);
    console.log(`    Status      : ${statusColor(statusText)}`);
    console.log(`    Enabled     : ${n.enabled ? color.green('✓') : color.red('✗')}`);
    console.log('');
  }

  console.log(color.dim(`  Total: ${numbers.length} nomor terkonfigurasi`));
  console.log('');
}

export function addNumber(id: string, sessionName: string, label?: string): void {
  const numbers = loadNumbers();

  if (numbers.some(n => n.id === id)) {
    console.log(color.red(`✗ Nomor dengan ID "${id}" sudah ada.`));
    return;
  }
  if (numbers.some(n => n.sessionName === sessionName)) {
    console.log(color.red(`✗ Session "${sessionName}" sudah digunakan oleh nomor lain.`));
    return;
  }

  const newNumber: WhatsAppNumberConfig = {
    id,
    sessionName,
    label: label || id,
    enabled: true,
  };

  numbers.push(newNumber);
  saveNumbers(numbers);

  console.log(color.green(`\n✓ Nomor "${id}" berhasil ditambahkan!`));
  console.log(color.cyan(`  Session : ${sessionName}`));
  console.log(color.cyan(`  Label   : ${newNumber.label}`));
  console.log(color.dim(`  Jalankan "wagent start" untuk connect nomor ini\n`));
}

export function removeNumber(id: string, options: { force?: boolean }): void {
  const numbers = loadNumbers();
  const idx = numbers.findIndex(n => n.id === id);

  if (idx === -1) {
    console.log(color.red(`✗ Nomor dengan ID "${id}" tidak ditemukan.`));
    return;
  }

  const removed = numbers[idx];

  if (!options.force) {
    console.log(color.yellow(`\n⚠️  Yakin hapus nomor "${id}"?`));
    console.log(color.yellow(`   Session "${removed.sessionName}" tidak akan dihapus.`));
    console.log(color.dim('   Gunakan --force untuk skip konfirmasi'));
    console.log('');
    return;
  }

  numbers.splice(idx, 1);
  saveNumbers(numbers);

  console.log(color.green(`\n✓ Nomor "${id}" berhasil dihapus.`));
  console.log(color.dim(`  Session folder "${removed.sessionName}" tidak terhapus.`));
  console.log(color.dim(`  Hapus manual: rm -rf .sessions/${removed.sessionName}\n`));
}
