import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import color from 'picocolors';
import {
  loadConfig,
  Database,
  KnowledgeStore,
  KnowledgeEntry
} from '@wagent/core';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function listKb(options: { category?: string }): Promise<void> {
  const config = await loadConfig();
  const db = new Database(config.databaseUrl);
  const entries = options.category
    ? db.getAllKnowledgeEntries(options.category)
    : db.getAllKnowledgeEntries();

  console.log('');
  console.log(color.bold('📚 Knowledge Base Entries'));
  console.log('────────────────────────────');

  if (entries.length === 0) {
    console.log(color.dim('  Belum ada entri knowledge base.'));
    console.log(color.dim('  Tambah: wagent kb add'));
    console.log('');
    db.close();
    return;
  }

  console.log(color.dim(`  Total: ${entries.length} entri\n`));

  for (const entry of entries) {
    const question = entry.question || '(tanpa pertanyaan)';
    const answerPreview = entry.answer.substring(0, 80) + (entry.answer.length > 80 ? '...' : '');
    const tags = entry.tags.length > 0 ? entry.tags.join(', ') : '';

    console.log(`  ${color.cyan(entry.id)}`);
    console.log(`    Kategori  : ${entry.category}`);
    console.log(`    Pertanyaan: ${question}`);
    console.log(`    Jawaban   : ${answerPreview}`);
    console.log(`    Prioritas : ${'⭐'.repeat(entry.priority) || '-'}`);
    if (tags) console.log(`    Tags      : ${color.dim(tags)}`);
    console.log('');
  }

  db.close();
}

export async function addKb(options: {
  answer: string;
  question?: string;
  category?: string;
  keywords?: string;
  tags?: string;
  priority: string;
}): Promise<void> {
  const config = await loadConfig();
  const db = new Database(config.databaseUrl);

  const id = `kb-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const keywords = options.keywords ? options.keywords.split(',').map((k: string) => k.trim()) : [];
  const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [];

  const entry: KnowledgeEntry = {
    id,
    category: options.category || 'general',
    question: options.question || '',
    answer: options.answer,
    keywords,
    tags,
    priority: parseInt(options.priority, 10) || 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  db.createKnowledgeEntry(entry);
  db.close();

  console.log(color.green(`\n✓ Entri knowledge base berhasil ditambahkan!`));
  console.log(color.cyan(`  ID       : ${id}`));
  console.log(color.cyan(`  Kategori : ${entry.category}`));
  if (entry.question) console.log(color.cyan(`  Tanya    : ${entry.question}`));
  console.log('');
}

export async function removeKb(id: string): Promise<void> {
  const config = await loadConfig();
  const db = new Database(config.databaseUrl);
  const existing = db.getKnowledgeEntry(id);

  if (!existing) {
    console.log(color.red(`✗ Entri dengan ID "${id}" tidak ditemukan.`));
    console.log('');
    db.close();
    return;
  }

  db.deleteKnowledgeEntry(id);
  db.close();

  console.log(color.green(`\n✓ Entri "${id}" berhasil dihapus.`));
  console.log('');
}

export async function searchKb(query: string, options: { limit: string }): Promise<void> {
  const config = await loadConfig();
  const db = new Database(config.databaseUrl);
  const limit = parseInt(options.limit, 10) || 5;

  const results = db.searchKnowledge(query, limit);
  db.close();

  console.log('');
  console.log(color.bold(`🔍 Hasil pencarian: "${query}"`));
  console.log('────────────────────────────────');

  if (results.length === 0) {
    console.log(color.dim('  Tidak ada hasil yang cocok.'));
    console.log('');
    return;
  }

  console.log(color.dim(`  ${results.length} hasil ditemukan\n`));

  for (const result of results) {
    const entry = result.entry;
    const question = entry.question || '(tanpa pertanyaan)';
    const answerPreview = entry.answer.substring(0, 100) + (entry.answer.length > 100 ? '...' : '');

    console.log(`  ${color.cyan(entry.id)} [${Math.round(result.score * 100)}% match]`);
    console.log(`    ${color.dim('Tanya:')} ${question}`);
    console.log(`    ${color.dim('Jawab:')} ${answerPreview}`);
    console.log(`    ${color.dim('Kategori:')} ${entry.category} | ${color.dim('Prioritas:')} ${entry.priority}`);
    console.log('');
  }
}

function parseKbSeedMd(content: string): KnowledgeEntry[] {
  const entries: KnowledgeEntry[] = [];
  const now = new Date();
  const blocks = content.split(/^---$/m);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    if (lines[0].startsWith('#') || lines[0].startsWith('##')) continue;

    const meta: Record<string, string> = {};
    let answerStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        meta[match[1]] = match[2].trim();
      } else if (Object.keys(meta).length > 0 && line.trim() === '') {
        answerStart = i + 1;
        break;
      } else if (Object.keys(meta).length > 0) {
        answerStart = i;
        break;
      }
    }

    if (!meta.id) continue;

    const answer = lines.slice(answerStart).join('\n').trim();
    if (!answer) continue;

    entries.push({
      id: meta.id,
      category: meta.category || 'umum',
      question: meta.question || '',
      answer,
      keywords: meta.keywords ? meta.keywords.split(',').map(k => k.trim()) : [],
      tags: meta.tags ? meta.tags.split(',').map(t => t.trim()) : [],
      priority: parseInt(meta.priority || '3', 10),
      createdAt: now,
      updatedAt: now,
    });
  }

  return entries;
}

export async function seedKb(options: { clear?: boolean }): Promise<void> {
  const config = await loadConfig();
  const db = new Database(config.databaseUrl);

  if (options.clear) {
    const existing = db.getAllKnowledgeEntries();
    for (const e of existing) db.deleteKnowledgeEntry(e.id);
    console.log(color.dim(`  Menghapus ${existing.length} entri yang ada...`));
  }

  const seedPaths = [
    join(__dirname, '../../../data/kb-seed.md'),
    join(__dirname, '../../data/kb-seed.md'),
    join(process.cwd(), 'kb-seed.md'),
  ];

  let seedFile = '';
  for (const p of seedPaths) {
    if (existsSync(p)) {
      seedFile = readFileSync(p, 'utf-8');
      break;
    }
  }

  if (!seedFile) {
    console.log(color.red('  ❌ File kb-seed.md tidak ditemukan!'));
    db.close();
    return;
  }

  const seedEntries = parseKbSeedMd(seedFile);

  let added = 0;
  for (const entry of seedEntries) {
    if (!db.getKnowledgeEntry(entry.id)) {
      db.createKnowledgeEntry(entry);
      added++;
    }
  }

  db.close();

  console.log('');
  console.log(color.bold('🌱 Knowledge Base Seeder'));
  console.log('────────────────────────────────');
  console.log(color.green(`  ✅ ${added} entri baru ditambahkan!`));
  console.log('');
  console.log(color.cyan('  📂 Kategori:'));
  const categories = [...new Set(seedEntries.map(e => e.category))];
  const counts = categories.map(cat => ({
    cat,
    count: seedEntries.filter(e => e.category === cat).length,
  }));
  for (const { cat, count } of counts) {
    console.log(`    ${color.dim('•')} ${cat}: ${count} entri ${cat === 'pengiriman' ? '📦' : cat === 'refund' ? '💰' : cat === 'operasional' ? '⏰' : cat === 'pembayaran' ? '💳' : cat === 'pesanan' ? '📋' : cat === 'keluhan' ? '🛡️' : '📄'}`);
  }
  console.log('');
  console.log(color.dim('  Gunakan "wagent kb list" untuk melihat semua entri.'));
  console.log(color.dim('  Atau coba: wagent kb search "ongkir jakarta"'));
  console.log('');
}

export async function categoriesKb(): Promise<void> {
  const config = await loadConfig();
  const db = new Database(config.databaseUrl);
  const categories = db.getKnowledgeCategories();
  const total = db.getKnowledgeCount();
  db.close();

  console.log('');
  console.log(color.bold('📂 Knowledge Base Categories'));
  console.log('────────────────────────────────');

  if (categories.length === 0) {
    console.log(color.dim('  Belum ada kategori.'));
    console.log('');
    return;
  }

  for (const cat of categories) {
    console.log(`  ${color.cyan(cat)}`);
  }
  console.log('');
  console.log(color.dim(`  Total entri: ${total} | Total kategori: ${categories.length}`));
  console.log('');
}

export async function uploadFileKb(filePath: string): Promise<void> {
  const resolvedPath = filePath.startsWith('/') ? filePath : join(process.cwd(), filePath);

  if (!existsSync(resolvedPath)) {
    console.log(color.red(`\n✗ File tidak ditemukan: ${resolvedPath}`));
    console.log('');
    return;
  }

  const config = await loadConfig();
  const db = new Database(config.databaseUrl);
  const store = new KnowledgeStore(db, config);

  console.log(color.cyan(`\n📁 Uploading ${filePath}...`));

  const result = await store.uploadFile(resolvedPath);
  db.close();

  if (result.status === 'failed') {
    console.log(color.red(`\n✗ Upload gagal: ${result.error}`));
  } else {
    console.log(color.green(`\n✓ File berhasil diupload!`));
    console.log(color.cyan(`  File ID  : ${result.fileId}`));
    console.log(color.cyan(`  Nama     : ${result.fileName}`));
    console.log(color.cyan(`  Chunks   : ${result.totalChunks}`));
    console.log(color.cyan(`  Embedded : ${result.embeddedChunks}/${result.totalChunks}`));
    console.log(color.cyan(`  Status   : ${result.status}`));
  }
  console.log('');
}

export async function manageFilesKb(action?: string, name?: string): Promise<void> {
  const config = await loadConfig();
  const db = new Database(config.databaseUrl);
  const store = new KnowledgeStore(db, config);

  if (action === 'delete') {
    if (!name) {
      console.log(color.red('\n✗ Nama file harus disertakan: wagent kb files delete <nama-file>'));
      db.close();
      return;
    }
    const deleted = store.deleteFileByName(name);
    if (deleted) {
      console.log(color.green(`\n✓ File "${name}" berhasil dihapus.`));
    } else {
      console.log(color.red(`\n✗ File "${name}" tidak ditemukan.`));
    }
    db.close();
    return;
  }

  if (action === 'embed') {
    console.log(color.cyan('\n🧮 Embedding chunks...'));
    const result = await store.embedPendingChunks();
    db.close();
    console.log(color.green(`\n✓ Selesai!`));
    console.log(color.cyan(`  Embedded : ${result.embedded}/${result.total}`));
    if (result.failed > 0) console.log(color.yellow(`  Gagal    : ${result.failed}`));
    return;
  }

  const files = store.listFiles();
  const stats = store.getStats();
  db.close();

  console.log('');
  console.log(color.bold('📄 Knowledge Store Files'));
  console.log('────────────────────────────────');

  if (files.length === 0) {
    console.log(color.dim('  Belum ada file yang diupload.'));
    console.log(color.dim('  Upload: wagent kb upload <file>'));
    console.log('');
    return;
  }

  console.log(color.dim(`  Total: ${files.length} file, ${stats.totalChunks} chunks\n`));

  for (const file of files) {
    const sizeKB = (file.fileSize / 1024).toFixed(1);
    const statusIcon = file.status === 'ready' ? '✅' : file.status === 'partial' ? '⚠️' : '❌';

    console.log(`  ${statusIcon} ${color.cyan(file.fileName)}`);
    console.log(`    ID       : ${color.dim(file.id)}`);
    console.log(`    Tipe     : ${file.fileExtension}`);
    console.log(`    Ukuran   : ${sizeKB} KB`);
    console.log(`    Chunks   : ${file.chunkCount}`);
    console.log(`    Status   : ${file.status}`);
    console.log(`    Upload   : ${file.createdAt.toLocaleString('id-ID')}`);
    console.log('');
  }
}
