import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryManager } from './memory-manager.js';
import { ContactProfile, MemoryEntry } from './types.js';
import { Summarizer } from './summarizer.js';

describe('MemoryManager', () => {
  let mm: MemoryManager;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `wagent-memory-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mm = new MemoryManager(testDir);
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  // ── Initialization ──────────────────────────────────────────

  describe('initialization', () => {
    it('should create memory directories', () => {
      expect(existsSync(join(testDir, 'contacts'))).toBe(true);
      expect(existsSync(join(testDir, 'conversations'))).toBe(true);
      expect(existsSync(join(testDir, '_global'))).toBe(true);
    });

    it('should use default directory when none provided', () => {
      const defaultMm = new MemoryManager();
      expect(defaultMm.getMemoryDir()).toContain('memory');
      // Don't clean up — this uses the real project dir
    });
  });

  // ── Contact Profiles ────────────────────────────────────────

  describe('contact profiles', () => {
    const profile: ContactProfile = {
      contactId: 'budi@s.whatsapp.net',
      name: 'Budi Santoso',
      relationship: 'Teman kuliah',
      tone: 'casual',
      language: 'Indonesia campur Inggris',
      greetings: ['Bro', 'Brod'],
      emojiUsage: 'rare',
      exampleResponses: ['Oke bro gas aja', 'Siap bossku'],
      topics: ['Gaming', 'Kerjaan'],
      updatedAt: new Date(),
    };

    it('should save and load a contact profile', () => {
      mm.saveContactProfile(profile);
      const loaded = mm.loadContactProfile('budi@s.whatsapp.net');
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe('Budi Santoso');
      expect(loaded!.tone).toBe('casual');
      expect(loaded!.relationship).toBe('Teman kuliah');
      expect(loaded!.language).toBe('Indonesia campur Inggris');
    });

    it('should return null for non-existent profile', () => {
      const loaded = mm.loadContactProfile('nonexistent@s.whatsapp.net');
      expect(loaded).toBeNull();
    });

    it('should update an existing profile', () => {
      mm.saveContactProfile(profile);
      
      const updated: ContactProfile = {
        ...profile,
        tone: 'formal',
        greetings: ['Pak'],
      };
      mm.saveContactProfile(updated);
      
      const loaded = mm.loadContactProfile('budi@s.whatsapp.net');
      expect(loaded!.tone).toBe('formal');
      expect(loaded!.greetings).toEqual(['Pak']);
    });

    it('should list contact profiles', () => {
      mm.saveContactProfile(profile);
      mm.saveContactProfile({
        ...profile,
        contactId: 'customer@s.whatsapp.net',
        name: 'Customer Joni',
      });

      const list = mm.listContactProfiles();
      expect(list.length).toBe(2);
      expect(list.some(p => p.name === 'Budi Santoso')).toBe(true);
      expect(list.some(p => p.name === 'Customer Joni')).toBe(true);
    });

    it('should handle special characters in contact IDs', () => {
      const specialProfile: ContactProfile = {
        contactId: 'test@c.us',
        name: 'Test User',
        tone: 'friendly',
        updatedAt: new Date(),
      };
      mm.saveContactProfile(specialProfile);
      const loaded = mm.loadContactProfile('test@c.us');
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe('Test User');
    });

    it('should parse markdown fields correctly', () => {
      mm.saveContactProfile(profile);
      const loaded = mm.loadContactProfile('budi@s.whatsapp.net');
      expect(loaded!.topics).toEqual(['Gaming', 'Kerjaan']);
      expect(loaded!.exampleResponses).toContain('Oke bro gas aja');
    });
  });

  // ── Short-term Memory (JSONL) ───────────────────────────────

  describe('short-term memory (JSONL)', () => {
    it('should append and read memory entries', () => {
      mm.appendMemory('user@s.whatsapp.net', 'user', 'Halo!');
      mm.appendMemory('user@s.whatsapp.net', 'assistant', 'Halo juga!');
      mm.appendMemory('user@s.whatsapp.net', 'user', 'Apa kabar?');

      const entries = mm.readRecentMemory('user@s.whatsapp.net', 10);
      expect(entries.length).toBe(3);
      expect(entries[0].role).toBe('user');
      expect(entries[0].content).toBe('Halo!');
      expect(entries[2].content).toBe('Apa kabar?');
    });

    it('should return empty for contacts with no memory', () => {
      const entries = mm.readRecentMemory('unknown@s.whatsapp.net');
      expect(entries).toEqual([]);
    });

    it('should limit number of entries returned', () => {
      for (let i = 0; i < 10; i++) {
        mm.appendMemory('limit@s.whatsapp.net', 'user', `Pesan ${i}`);
      }
      const entries = mm.readRecentMemory('limit@s.whatsapp.net', 3);
      expect(entries.length).toBeLessThanOrEqual(3);
    });

    it('should convert memory to AIMessage format', () => {
      mm.appendMemory('msg@s.whatsapp.net', 'user', 'Halo');
      mm.appendMemory('msg@s.whatsapp.net', 'assistant', 'Halo juga!');

      const messages = mm.getMemoryAsMessages('msg@s.whatsapp.net');
      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Halo');
      expect(messages[1].role).toBe('assistant');
    });

    it('should include metadata when provided', () => {
      mm.appendMemory('meta@s.whatsapp.net', 'user', 'Test', { source: 'web', priority: 1 });
      const entries = mm.readRecentMemory('meta@s.whatsapp.net');
      expect(entries.length).toBe(1);
      expect(entries[0].metadata?.source).toBe('web');
      expect(entries[0].metadata?.priority).toBe(1);
    });
  });

  // ── Long-term Memory (Markdown) ─────────────────────────────

  describe('long-term memory', () => {
    it('should add and retrieve facts', () => {
      mm.addFact('User suka kopi hitam');
      mm.addFact('User bekerja di bidang tech');

      const facts = mm.getFacts();
      expect(facts).toContain('User suka kopi hitam');
      expect(facts).toContain('User bekerja di bidang tech');
    });

    it('should add and retrieve patterns', () => {
      mm.addPattern('User sering kirim pesan malam hari');
      mm.addPattern('User lebih suka jawaban singkat');

      const patterns = mm.getPatterns();
      expect(patterns).toContain('User sering kirim pesan malam hari');
      expect(patterns).toContain('User lebih suka jawaban singkat');
    });

    it('should return empty string when no facts exist', () => {
      const facts = mm.getFacts();
      expect(facts).toBe('');
    });
  });

  // ── Conversation Summary ────────────────────────────────────

  describe('conversation summary', () => {
    it('should save and load conversation summary', () => {
      mm.saveConversationSummary('user@s.whatsapp.net', 'User bertanya tentang produk. Agent memberikan info harga.');
      const summary = mm.loadConversationSummary('user@s.whatsapp.net');
      expect(summary).toContain('User bertanya tentang produk');
    });

    it('should return null for non-existent summary', () => {
      const summary = mm.loadConversationSummary('unknown@s.whatsapp.net');
      expect(summary).toBeNull();
    });

    it('should overwrite existing summary', () => {
      mm.saveConversationSummary('user@s.whatsapp.net', 'Summary pertama');
      mm.saveConversationSummary('user@s.whatsapp.net', 'Summary kedua');
      const summary = mm.loadConversationSummary('user@s.whatsapp.net');
      expect(summary).toBe('Summary kedua');
    });
  });

  // ── Auto-Summarization: countMemoryEntries ──────────────────

  describe('countMemoryEntries', () => {
    it('should return 0 for contact with no memory', () => {
      const count = mm.countMemoryEntries('nonexistent@s.whatsapp.net');
      expect(count).toBe(0);
    });

    it('should count JSONL entries for a contact', () => {
      mm.appendMemory('count_test@s.whatsapp.net', 'user', 'Halo');
      mm.appendMemory('count_test@s.whatsapp.net', 'assistant', 'Halo juga');
      mm.appendMemory('count_test@s.whatsapp.net', 'user', 'Apa kabar?');

      const count = mm.countMemoryEntries('count_test@s.whatsapp.net');
      expect(count).toBe(3);
    });

    it('should only count the contact specified', () => {
      mm.appendMemory('alice@s.whatsapp.net', 'user', 'Halo Alice');
      mm.appendMemory('bob@s.whatsapp.net', 'user', 'Halo Bob');
      mm.appendMemory('bob@s.whatsapp.net', 'assistant', 'Halo juga Bob');

      expect(mm.countMemoryEntries('alice@s.whatsapp.net')).toBe(1);
      expect(mm.countMemoryEntries('bob@s.whatsapp.net')).toBe(2);
    });

    it('should count entries across multiple files up to 50 cap', () => {
      // Create entries across multiple days by writing directly to separate JSONL files
      const safeId = 'cap_test_s_whatsapp_net';
      const convDir = join(testDir, 'conversations', safeId);
      mkdirSync(convDir, { recursive: true });

      // Write 40 entries to first day
      const day1Entries = Array.from({ length: 40 }, (_, i) =>
        JSON.stringify({ contactId: 'cap_test@s.whatsapp.net', role: 'user', content: `Day1 ${i}`, timestamp: new Date().toISOString() })
      ).join('\n') + '\n';
      writeFileSync(join(convDir, '2024-01-01.jsonl'), day1Entries);

      // Write 30 entries to second day (total would be 70, but cap at 50)
      const day2Entries = Array.from({ length: 30 }, (_, i) =>
        JSON.stringify({ contactId: 'cap_test@s.whatsapp.net', role: 'user', content: `Day2 ${i}`, timestamp: new Date().toISOString() })
      ).join('\n') + '\n';
      writeFileSync(join(convDir, '2024-01-02.jsonl'), day2Entries);

      const count = mm.countMemoryEntries('cap_test@s.whatsapp.net');
      // After fix: count is capped at exactly 50 per-file using Math.min(lines.length, 50 - count)
      // Day2 (30 entries) → count = 30. Day1 (40 entries) → count = 30 + min(40, 20) = 50
      expect(count).toBe(50);
    });
  });

  // ── Auto-Summarization: needsSummarization ─────────────────

  describe('needsSummarization', () => {
    it('should return false when entries are below threshold', () => {
      mm.appendMemory('thresh@s.whatsapp.net', 'user', 'Test');
      expect(mm.needsSummarization('thresh@s.whatsapp.net', 5)).toBe(false);
    });

    it('should return true when entries meet threshold', () => {
      for (let i = 0; i < 5; i++) {
        mm.appendMemory('thresh2@s.whatsapp.net', 'user', `Pesan ${i}`);
      }
      expect(mm.needsSummarization('thresh2@s.whatsapp.net', 5)).toBe(true);
    });

    it('should use default threshold of 20', () => {
      for (let i = 0; i < 15; i++) {
        mm.appendMemory('def_thresh@s.whatsapp.net', 'user', `Pesan ${i}`);
      }
      expect(mm.needsSummarization('def_thresh@s.whatsapp.net')).toBe(false);

      for (let i = 15; i < 22; i++) {
        mm.appendMemory('def_thresh@s.whatsapp.net', 'user', `Pesan ${i}`);
      }
      expect(mm.needsSummarization('def_thresh@s.whatsapp.net')).toBe(true);
    });

    it('should return false for contacts with no memory', () => {
      expect(mm.needsSummarization('nonexistent@s.whatsapp.net')).toBe(false);
    });
  });

  // ── Auto-Summarization: generateAndSaveSummary ─────────────

  describe('generateAndSaveSummary', () => {
    it('should return null when no entries exist', async () => {
      const summarizer = new Summarizer({ config: { useAbstractive: false } });
      const result = await mm.generateAndSaveSummary('empty@s.whatsapp.net', summarizer);
      expect(result).toBeNull();
    });

    it('should generate and save an extractive summary from entries', async () => {
      mm.appendMemory('sum_test@s.whatsapp.net', 'user', 'Halo, ada promo?');
      mm.appendMemory('sum_test@s.whatsapp.net', 'assistant', 'Ada! Kami ada diskon 20%.');
      mm.appendMemory('sum_test@s.whatsapp.net', 'user', 'Wah menarik!');

      const summarizer = new Summarizer({ config: { useAbstractive: false } });
      const result = await mm.generateAndSaveSummary('sum_test@s.whatsapp.net', summarizer);

      expect(result).not.toBeNull();
      expect(result).toContain('Pesan terbaru');
      expect(result).toContain('diskon');

      // Verify the summary was saved to disk
      const saved = mm.loadConversationSummary('sum_test@s.whatsapp.net');
      expect(saved).toBe(result);
    });

    it('should return summary string on success', async () => {
      mm.appendMemory('ret_test@s.whatsapp.net', 'user', 'Test 1');
      mm.appendMemory('ret_test@s.whatsapp.net', 'assistant', 'Respon 1');

      const summarizer = new Summarizer({ config: { useAbstractive: false } });
      const result = await mm.generateAndSaveSummary('ret_test@s.whatsapp.net', summarizer);

      expect(result).toBeTypeOf('string');
      expect(result!.length).toBeGreaterThan(0);
    });

    it('should handle summarizer returning empty string', async () => {
      mm.appendMemory('empty_sum@s.whatsapp.net', 'system', 'only system');

      const mockSummarizer = {
        summarize: vi.fn().mockResolvedValue(''),
      } as unknown as Summarizer;

      const result = await mm.generateAndSaveSummary('empty_sum@s.whatsapp.net', mockSummarizer);
      expect(result).toBeNull();
    });
  });

  // ── Auto-Summarization: compactMemoryAfterSummary ──────────

  describe('compactMemoryAfterSummary', () => {
    const safeDir = (contactId: string) =>
      join(testDir, 'conversations', contactId.replace(/[@.:\/]/g, '_'));

    it('should return 0 when contact has no memory', () => {
      const deleted = mm.compactMemoryAfterSummary('nonexistent@s.whatsapp.net');
      expect(deleted).toBe(0);
    });

    it('should keep at least one JSONL file after compaction', () => {
      mm.appendMemory('compact@s.whatsapp.net', 'user', 'First entry');
      mm.appendMemory('compact@s.whatsapp.net', 'user', 'Second entry');

      // Create additional old JSONL files in the verified directory
      const convDir = safeDir('compact@s.whatsapp.net');
      mkdirSync(convDir, { recursive: true });
      writeFileSync(join(convDir, '2024-01-01.jsonl'), '{"role":"user","content":"old"}\n');
      writeFileSync(join(convDir, '2024-01-02.jsonl'), '{"role":"user","content":"older"}\n');

      const deleted = mm.compactMemoryAfterSummary('compact@s.whatsapp.net');

      // Should delete old files, keeping only the most recent
      expect(deleted).toBeGreaterThanOrEqual(2);

      const remainingFiles = readdirSync(convDir).filter(f => f.endsWith('.jsonl'));
      expect(remainingFiles.length).toBe(1); // Only today's file remains
    });

    it('should not delete files when only one JSONL exists', () => {
      mm.appendMemory('single@s.whatsapp.net', 'user', 'Only entry');

      const deleted = mm.compactMemoryAfterSummary('single@s.whatsapp.net');
      expect(deleted).toBe(0);

      const convDir = safeDir('single@s.whatsapp.net');
      const remainingFiles = readdirSync(convDir).filter(f => f.endsWith('.jsonl'));
      expect(remainingFiles.length).toBe(1);
    });

    it('should preserve summary.md file', () => {
      mm.appendMemory('preserve@s.whatsapp.net', 'user', 'Entry 1');
      mm.appendMemory('preserve@s.whatsapp.net', 'user', 'Entry 2');
      mm.saveConversationSummary('preserve@s.whatsapp.net', 'Test summary');

      // Create an old JSONL in the verified directory
      const convDir = safeDir('preserve@s.whatsapp.net');
      mkdirSync(convDir, { recursive: true });
      writeFileSync(join(convDir, '2024-01-01.jsonl'), '{"role":"user","content":"old"}\n');

      mm.compactMemoryAfterSummary('preserve@s.whatsapp.net');

      // summary.md should still exist
      expect(existsSync(join(convDir, 'summary.md'))).toBe(true);
      expect(readFileSync(join(convDir, 'summary.md'), 'utf-8')).toBe('Test summary');
    });
  });

  // ── Cleanup ──────────────────────────────────────────────────

  describe('cleanup', () => {
    it('should cleanup old memory files', () => {
      // Create a file that looks old (by date in filename)
      const oldDate = '2020-01-01';
      const convDir = join(testDir, 'conversations', 'old_user');
      mkdirSync(convDir, { recursive: true });
      writeFileSync(join(convDir, `${oldDate}.jsonl`), '{"test":"data"}\n');

      // Create a recent file that should NOT be cleaned
      const today = new Date().toISOString().split('T')[0];
      writeFileSync(join(convDir, `${today}.jsonl`), '{"test":"recent"}\n');

      const cleaned = mm.cleanupOldMemory(1); // 1 day old
      expect(cleaned).toBe(1);

      // Old file should be gone
      expect(existsSync(join(convDir, `${oldDate}.jsonl`))).toBe(false);
      // Recent file should remain
      expect(existsSync(join(convDir, `${today}.jsonl`))).toBe(true);
    });

    it('should handle empty conversation directory', () => {
      const cleaned = mm.cleanupOldMemory();
      expect(cleaned).toBe(0);
    });
  });
});
