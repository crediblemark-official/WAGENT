import { existsSync } from 'fs';
import { join } from 'path';
import color from 'picocolors';
import {
  isEncryptionAvailable,
  generateEncryptionKey,
  getEncryptionKey,
  encryptEnvFile,
  encryptDirectory,
  encryptFile,
  decryptEnvFile,
  decryptDirectory,
  decryptFile,
  getEncryptionStatus
} from '@wagent/core';

const ENV_PATH = join(process.cwd(), '.env');
const SESSION_DIR = join(process.cwd(), '.sessions');
const DB_PATH = join(process.cwd(), 'data', 'wagent.db');

export function initCrypto(): void {
  const keyExists = isEncryptionAvailable();
  if (keyExists) {
    console.log(color.yellow('\n⚠️  OPENCE_ENCRYPTION_KEY sudah terdeteksi.'));
    console.log(color.dim('  Gunakan "wagent crypto encrypt" untuk mengenkripsi data.'));
    console.log('');
    return;
  }

  const key = generateEncryptionKey();
  console.log('');
  console.log(color.bold('🔐 Encryption Key Generated'));
  console.log('');
  console.log(color.bold(color.yellow('⚠️  SIMPAN KEY INI — TIDAK BISA DIPULIHKAN!')));
  console.log(color.white('  ┌─────────────────────────────────────────────────────────────┐'));
  console.log(color.white(`  │ ${key} │`));
  console.log(color.white('  └─────────────────────────────────────────────────────────────┘'));
  console.log('');
  console.log(color.cyan('  Export key:'));
  console.log(color.dim(`  export OPENCE_ENCRYPTION_KEY=${key}`));
  console.log(color.dim('  Tambahkan ke ~/.bashrc atau ~/.zshrc agar permanen'));
  console.log('');
  console.log(color.dim('  Setelah export, jalankan: wagent crypto encrypt'));
  console.log('');
}

export function encryptData(): void {
  const keyHex = getEncryptionKey();
  if (!keyHex) {
    console.log(color.red('\n✗ OPENCE_ENCRYPTION_KEY tidak ditemukan.'));
    console.log(color.dim('  Jalankan "wagent crypto init" untuk generate key terlebih dahulu.'));
    console.log('');
    return;
  }

  const keyBuf = Buffer.from(keyHex, 'hex');
  let encryptedCount = 0;

  console.log('');
  console.log(color.bold('🔐 Mengenkripsi data sensitif...'));
  console.log('──────────────────────────────────────');

  // 1. Encrypt .env
  if (existsSync(ENV_PATH)) {
    try {
      encryptEnvFile(ENV_PATH, keyBuf);
      console.log(color.green('  ✓ .env → .env.encrypted'));
      encryptedCount++;
    } catch (err: any) {
      console.log(color.red(`  ✗ Gagal enkripsi .env: ${err.message}`));
    }
  } else {
    console.log(color.dim('  - .env tidak ditemukan, skip'));
  }

  // 2. Encrypt session files
  if (existsSync(SESSION_DIR)) {
    try {
      const count = encryptDirectory(SESSION_DIR, keyBuf, true);
      if (count > 0) {
        console.log(color.green(`  ✓ Session: ${count} file terenkripsi`));
        encryptedCount += count;
      } else {
        console.log(color.yellow('  ! Session: tidak ada file yang perlu dienkripsi'));
      }
    } catch (err: any) {
      console.log(color.red(`  ✗ Gagal enkripsi session: ${err.message}`));
    }
  } else {
    console.log(color.dim('  - Session folder tidak ditemukan, skip'));
  }

  // 3. Encrypt numbers.json
  const numbersPath = join(process.cwd(), 'data', 'numbers.json');
  if (existsSync(numbersPath)) {
    try {
      encryptFile(numbersPath, keyBuf, true);
      console.log(color.green('  ✓ numbers.json → numbers.json.encrypted'));
      encryptedCount++;
    } catch (err: any) {
      console.log(color.red(`  ✗ Gagal enkripsi numbers.json: ${err.message}`));
    }
  }

  // 4. Encrypt database
  if (existsSync(DB_PATH)) {
    try {
      encryptFile(DB_PATH, keyBuf, true);
      console.log(color.green('  ✓ Database → wagent.db.encrypted'));
      encryptedCount++;
    } catch (err: any) {
      console.log(color.red(`  ✗ Gagal enkripsi database: ${err.message}`));
    }
  } else {
    console.log(color.dim('  - Database belum ada, akan dienkripsi otomatis saat shutdown'));
  }

  console.log('');
  if (encryptedCount > 0) {
    console.log(color.green(`✅ ${encryptedCount} item berhasil dienkripsi.`));
  } else {
    console.log(color.yellow('⚠️  Tidak ada data yang dienkripsi.'));
  }
  console.log('');
}

export function decryptData(): void {
  const keyHex = getEncryptionKey();
  if (!keyHex) {
    console.log(color.red('\n✗ OPENCE_ENCRYPTION_KEY tidak ditemukan.'));
    console.log('');
    return;
  }

  const keyBuf = Buffer.from(keyHex, 'hex');
  let decryptedCount = 0;

  console.log('');
  console.log(color.bold('🔓 Mendekripsi data...'));
  console.log('──────────────────────────────────────');

  // 1. Decrypt .env
  const envEncPath = ENV_PATH + '.encrypted';
  if (existsSync(envEncPath)) {
    try {
      decryptEnvFile(ENV_PATH, keyBuf);
      console.log(color.green('  ✓ .env.encrypted → .env'));
      decryptedCount++;
    } catch (err: any) {
      console.log(color.red(`  ✗ Gagal dekripsi .env: ${err.message}`));
    }
  }

  // 2. Decrypt session
  if (existsSync(SESSION_DIR)) {
    try {
      const count = decryptDirectory(SESSION_DIR, keyBuf, true);
      if (count > 0) {
        console.log(color.green(`  ✓ Session: ${count} file didekripsi`));
        decryptedCount += count;
      }
    } catch (err: any) {
      console.log(color.red(`  ✗ Gagal dekripsi session: ${err.message}`));
    }
  }

  // 3. Decrypt numbers.json
  const numbersEncPath = join(process.cwd(), 'data', 'numbers.json.encrypted');
  if (existsSync(numbersEncPath)) {
    try {
      decryptFile(numbersEncPath, keyBuf, true);
      console.log(color.green('  ✓ numbers.json.encrypted → numbers.json'));
      decryptedCount++;
    } catch (err: any) {
      console.log(color.red(`  ✗ Gagal dekripsi numbers.json: ${err.message}`));
    }
  }

  // 4. Decrypt database
  const dbEncPath = join(process.cwd(), 'data', 'wagent.db.encrypted');
  if (existsSync(dbEncPath)) {
    try {
      decryptFile(dbEncPath, keyBuf, true);
      console.log(color.green('  ✓ Database: wagent.db.encrypted → wagent.db'));
      decryptedCount++;
    } catch (err: any) {
      console.log(color.red(`  ✗ Gagal dekripsi database: ${err.message}`));
    }
  }

  console.log('');
  if (decryptedCount > 0) {
    console.log(color.green(`✅ ${decryptedCount} item berhasil didekripsi.`));
  } else {
    console.log(color.yellow('⚠️  Tidak ada file terenkripsi yang ditemukan.'));
  }
  console.log('');
}

export function statusCrypto(): void {
  const status = getEncryptionStatus(ENV_PATH, SESSION_DIR, DB_PATH);

  console.log('');
  console.log(color.bold('🔐 Encryption Status'));
  console.log('────────────────────────────');
  console.log(`  Key ${status.keySet ? color.green('✓ Terpasang') : color.red('✗ Tidak ada (export OPENCE_ENCRYPTION_KEY)')}`);
  console.log(`  .env          : ${status.envEncrypted ? color.green('🔒 Terenkripsi') : color.dim('📄 Plaintext')}`);
  console.log(`  Session files : ${status.sessionEncrypted > 0 ? color.green(`🔒 ${status.sessionEncrypted} file`) : color.dim('📄 Plaintext')}`);
  console.log(`  Database      : ${status.dbEncrypted ? color.green('🔒 Terenkripsi') : color.dim('📄 Plaintext')}`);
  console.log('');

  if (!status.keySet) {
    console.log(color.dim('  Untuk mengaktifkan enkripsi:'));
    console.log(color.dim('    1. wagent crypto init       — generate key'));
    console.log(color.dim('    2. export OPENCE_ENCRYPTION_KEY=...'));
    console.log(color.dim('    3. wagent crypto encrypt    — enkripsi data'));
    console.log('');
  }
}
