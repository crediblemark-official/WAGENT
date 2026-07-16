import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { MemoryManager } from '../agent/memory-manager.js';
import { ContactProfile, MemoryEntry } from '../types.js';

vi.mock('../utils/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  }),
}));

let tmpDir: string;

function makeProfile(overrides?: Partial<ContactProfile>): ContactProfile {
  return {
    contactId: 'test-user@s.whatsapp.net',
    name: 'Test User',
    tone: 'casual',
    updatedAt: new Date('2026-07-15T10:00:00Z'),
    ...overrides,
  };
}

describe('MemoryManager', () => {
  beforeEach(() => {
    tmpDir = join(process.cwd(), 'tmp', randomUUID());
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    const { rmSync } = require('fs');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Contact Profiles ──────────────────────────────────────

  describe('saveContactProfile / loadContactProfile', () => {
    it('should roundtrip save and load a contact profile', () => {
      const mm = new MemoryManager(tmpDir);
      const profile = makeProfile({
        relationship: 'Teman kuliah',
        language: 'Indonesia campur Inggris',
        greetings: ['Bro', 'Brod'],
        emojiUsage: 'rare',
        exampleResponses: ['Oke bro gas aja'],
        topics: ['Gaming', 'Kerjaan'],
        notes: 'Suka main malam',
      });

      mm.saveContactProfile(profile);
      const loaded = mm.loadContactProfile(profile.contactId);

      expect(loaded).not.toBeNull();
      expect(loaded!.contactId).toBe(profile.contactId);
      expect(loaded!.name).toBe(profile.name);
      expect(loaded!.tone).toBe('casual');
      expect(loaded!.relationship).toBe('Teman kuliah');
      expect(loaded!.language).toBe('Indonesia campur Inggris');
      expect(loaded!.greetings).toEqual(['Bro', 'Brod']);
      expect(loaded!.emojiUsage).toBe('rare');
      expect(loaded!.exampleResponses).toEqual(['Oke bro gas aja']);
      expect(loaded!.topics).toEqual(['Gaming', 'Kerjaan']);
      expect(loaded!.notes).toBe('Suka main malam');
    });

    it('should handle special characters in contactId', () => {
      const mm = new MemoryManager(tmpDir);
      const profile = makeProfile({ contactId: '1234567890:12@g.us' });
      mm.saveContactProfile(profile);
      const loaded = mm.loadContactProfile(profile.contactId);

      expect(loaded).not.toBeNull();
      expect(loaded!.contactId).toBe('1234567890:12@g.us');
    });

    it('should update existing profile on re-save', () => {
      const mm = new MemoryManager(tmpDir);
      const profile = makeProfile({ name: 'Old Name' });
      mm.saveContactProfile(profile);

      const updated = makeProfile({ name: 'New Name' });
      mm.saveContactProfile(updated);

      const loaded = mm.loadContactProfile(profile.contactId);
      expect(loaded!.name).toBe('New Name');
    });
  });

  describe('loadContactProfile - non-existent', () => {
    it('should return null for non-existent contact', () => {
      const mm = new MemoryManager(tmpDir);
      expect(mm.loadContactProfile('nonexistent@s.whatsapp.net')).toBeNull();
    });
  });

  describe('listContactProfiles', () => {
    it('should list all saved profiles', () => {
      const mm = new MemoryManager(tmpDir);
      mm.saveContactProfile(makeProfile({ contactId: 'alice@s.whatsapp.net', name: 'Alice' }));
      mm.saveContactProfile(makeProfile({ contactId: 'bob@s.whatsapp.net', name: 'Bob' }));

      const list = mm.listContactProfiles();
      expect(list).toHaveLength(2);
      expect(list.map(p => p.name).sort()).toEqual(['Alice', 'Bob']);
    });

    it('should return empty array when no profiles exist', () => {
      const mm = new MemoryManager(tmpDir);
      expect(mm.listContactProfiles()).toEqual([]);
    });
  });

  // ── Short-term Memory (JSONL) ─────────────────────────────

  describe('appendMemory / readRecentMemory', () => {
    it('should roundtrip append and read memory entries', () => {
      const mm = new MemoryManager(tmpDir);
      const cid = 'test-user@s.whatsapp.net';

      mm.appendMemory(cid, 'user', 'Hello there');
      mm.appendMemory(cid, 'assistant', 'Hi! How can I help?');

      const entries = mm.readRecentMemory(cid);
      expect(entries).toHaveLength(2);
      expect(entries[0].role).toBe('user');
      expect(entries[0].content).toBe('Hello there');
      expect(entries[1].role).toBe('assistant');
      expect(entries[1].content).toBe('Hi! How can I help?');
    });

    it('should include metadata when provided', () => {
      const mm = new MemoryManager(tmpDir);
      const cid = 'test-user@s.whatsapp.net';
      mm.appendMemory(cid, 'user', 'msg', { tokens: 10 });

      const entries = mm.readRecentMemory(cid);
      expect(entries[0].metadata).toEqual({ tokens: 10 });
    });

    it('should return empty array for non-existent contact', () => {
      const mm = new MemoryManager(tmpDir);
      expect(mm.readRecentMemory('nobody@s.whatsapp.net')).toEqual([]);
    });
  });

  describe('readRecentMemory - maxEntries', () => {
    it('should respect maxEntries limit', () => {
      const mm = new MemoryManager(tmpDir);
      const cid = 'test-user@s.whatsapp.net';

      for (let i = 0; i < 10; i++) {
        mm.appendMemory(cid, 'user', `msg ${i}`);
      }

      const entries = mm.readRecentMemory(cid, 3);
      expect(entries).toHaveLength(3);
      // Most recent entries first due to reverse reading
      expect(entries[2].content).toBe('msg 9');
    });
  });

  describe('readRecentMemory - multiple days', () => {
    it('should read entries across multiple day files', () => {
      const mm = new MemoryManager(tmpDir);
      const cid = 'test-user@s.whatsapp.net';
      const safeCid = cid.replace(/[@.:\/]/g, '_');
      const convDir = join(tmpDir, 'conversations', safeCid);
      mkdirSync(convDir, { recursive: true });

      // Write yesterday's file manually
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      writeFileSync(
        join(convDir, `${yesterdayStr}.jsonl`),
        JSON.stringify({
          contactId: cid,
          role: 'user',
          content: 'old message',
          timestamp: yesterday.toISOString(),
        }) + '\n'
      );

      // Append today's entries via API
      mm.appendMemory(cid, 'user', 'new message');

      const entries = mm.readRecentMemory(cid, 50);
      expect(entries.length).toBeGreaterThanOrEqual(2);
      const contents = entries.map(e => e.content);
      expect(contents).toContain('old message');
      expect(contents).toContain('new message');
    });
  });

  // ── getMemoryAsMessages ───────────────────────────────────

  describe('getMemoryAsMessages', () => {
    it('should convert memory entries to AIMessage format', () => {
      const mm = new MemoryManager(tmpDir);
      const cid = 'test-user@s.whatsapp.net';

      mm.appendMemory(cid, 'user', 'Question?');
      mm.appendMemory(cid, 'assistant', 'Answer!');
      mm.appendMemory(cid, 'system', 'internal note');

      const messages = mm.getMemoryAsMessages(cid);
      // system entries are filtered out
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: 'user', content: 'Question?' });
      expect(messages[1]).toEqual({ role: 'assistant', content: 'Answer!' });
    });

    it('should respect maxEntries', () => {
      const mm = new MemoryManager(tmpDir);
      const cid = 'test-user@s.whatsapp.net';

      for (let i = 0; i < 5; i++) {
        mm.appendMemory(cid, 'user', `msg ${i}`);
      }

      const messages = mm.getMemoryAsMessages(cid, 2);
      expect(messages).toHaveLength(2);
    });
  });

  // ── Global Facts ──────────────────────────────────────────

  describe('addFact / getFacts', () => {
    it('should roundtrip add and get facts', () => {
      const mm = new MemoryManager(tmpDir);
      mm.addFact('User prefers Indonesian');
      mm.addFact('User is a developer');

      const facts = mm.getFacts();
      expect(facts).toContain('User prefers Indonesian');
      expect(facts).toContain('User is a developer');
    });

    it('should return empty string when no facts exist', () => {
      const mm = new MemoryManager(tmpDir);
      expect(mm.getFacts()).toBe('');
    });
  });

  // ── Patterns ──────────────────────────────────────────────

  describe('addPattern / getPatterns', () => {
    it('should roundtrip add and get patterns', () => {
      const mm = new MemoryManager(tmpDir);
      mm.addPattern('Always greet with "Halo"');
      mm.addPattern('Uses abbreviations frequently');

      const patterns = mm.getPatterns();
      expect(patterns).toContain('Always greet with "Halo"');
      expect(patterns).toContain('Uses abbreviations frequently');
    });

    it('should return empty string when no patterns exist', () => {
      const mm = new MemoryManager(tmpDir);
      expect(mm.getPatterns()).toBe('');
    });
  });

  // ── Conversation Summary ──────────────────────────────────

  describe('saveConversationSummary / loadConversationSummary', () => {
    it('should roundtrip save and load summary', () => {
      const mm = new MemoryManager(tmpDir);
      const cid = 'test-user@s.whatsapp.net';
      const summary = 'User asked about project status and discussed timeline.';

      mm.saveConversationSummary(cid, summary);
      const loaded = mm.loadConversationSummary(cid);

      expect(loaded).toBe(summary);
    });

    it('should return null for non-existent summary', () => {
      const mm = new MemoryManager(tmpDir);
      expect(mm.loadConversationSummary('nobody@s.whatsapp.net')).toBeNull();
    });

    it('should overwrite existing summary', () => {
      const mm = new MemoryManager(tmpDir);
      const cid = 'test-user@s.whatsapp.net';
      mm.saveConversationSummary(cid, 'old summary');
      mm.saveConversationSummary(cid, 'new summary');
      expect(mm.loadConversationSummary(cid)).toBe('new summary');
    });
  });

  // ── countMemoryEntries ────────────────────────────────────

  describe('countMemoryEntries', () => {
    it('should count entries correctly', () => {
      const mm = new MemoryManager(tmpDir);
      const cid = 'test-user@s.whatsapp.net';

      mm.appendMemory(cid, 'user', 'a');
      mm.appendMemory(cid, 'assistant', 'b');
      mm.appendMemory(cid, 'user', 'c');

      expect(mm.countMemoryEntries(cid)).toBe(3);
    });

    it('should return 0 for non-existent contact', () => {
      const mm = new MemoryManager(tmpDir);
      expect(mm.countMemoryEntries('nobody@s.whatsapp.net')).toBe(0);
    });
  });

  // ── needsSummarization ────────────────────────────────────

  describe('needsSummarization', () => {
    it('should return false below threshold', () => {
      const mm = new MemoryManager(tmpDir);
      const cid = 'test-user@s.whatsapp.net';

      for (let i = 0; i < 5; i++) {
        mm.appendMemory(cid, 'user', `msg ${i}`);
      }

      expect(mm.needsSummarization(cid, 20)).toBe(false);
    });

    it('should return true at threshold', () => {
      const mm = new MemoryManager(tmpDir);
      const cid = 'test-user@s.whatsapp.net';

      for (let i = 0; i < 20; i++) {
        mm.appendMemory(cid, 'user', `msg ${i}`);
      }

      expect(mm.needsSummarization(cid, 20)).toBe(true);
    });

    it('should use custom minEntries', () => {
      const mm = new MemoryManager(tmpDir);
      const cid = 'test-user@s.whatsapp.net';

      for (let i = 0; i < 5; i++) {
        mm.appendMemory(cid, 'user', `msg ${i}`);
      }

      expect(mm.needsSummarization(cid, 3)).toBe(true);
    });
  });

  // ── compactMemoryAfterSummary ─────────────────────────────

  describe('compactMemoryAfterSummary', () => {
    it('should delete old JSONL files keeping the most recent', () => {
      const mm = new MemoryManager(tmpDir);
      const cid = 'test-user@s.whatsapp.net';
      const safeCid = cid.replace(/[@.:\/]/g, '_');
      const convDir = join(tmpDir, 'conversations', safeCid);
      mkdirSync(convDir, { recursive: true });

      // Create 3 day files manually
      for (let i = 3; i >= 1; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        writeFileSync(
          join(convDir, `${dateStr}.jsonl`),
          JSON.stringify({ contactId: cid, role: 'user', content: `day ${i}`, timestamp: d.toISOString() }) + '\n'
        );
      }
      // Add today
      mm.appendMemory(cid, 'user', 'today');

      const jsonlFiles = readdirSync(convDir).filter(f => f.endsWith('.jsonl'));
      expect(jsonlFiles.length).toBe(4);

      const deleted = mm.compactMemoryAfterSummary(cid);
      expect(deleted).toBe(3);

      const remaining = readdirSync(convDir).filter(f => f.endsWith('.jsonl'));
      expect(remaining.length).toBe(1);
    });

    it('should return 0 for non-existent contact', () => {
      const mm = new MemoryManager(tmpDir);
      expect(mm.compactMemoryAfterSummary('nobody@s.whatsapp.net')).toBe(0);
    });
  });

  // ── cleanupOldMemory ──────────────────────────────────────

  describe('cleanupOldMemory', () => {
    it('should remove files older than specified days', () => {
      const mm = new MemoryManager(tmpDir);
      const cid = 'test-user@s.whatsapp.net';
      const convDir = join(tmpDir, 'conversations', cid);
      mkdirSync(convDir, { recursive: true });

      // Old file (60 days ago)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 60);
      const oldStr = oldDate.toISOString().split('T')[0];
      writeFileSync(join(convDir, `${oldStr}.jsonl`), 'old\n');

      // Recent file (today)
      const today = new Date().toISOString().split('T')[0];
      writeFileSync(join(convDir, `${today}.jsonl`), 'new\n');

      const cleaned = mm.cleanupOldMemory(30);
      expect(cleaned).toBe(1);

      const remaining = readdirSync(convDir).filter(f => f.endsWith('.jsonl'));
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toBe(`${today}.jsonl`);
    });

    it('should return 0 when no old files exist', () => {
      const mm = new MemoryManager(tmpDir);
      const cid = 'test-user@s.whatsapp.net';
      mm.appendMemory(cid, 'user', 'recent');

      expect(mm.cleanupOldMemory(30)).toBe(0);
    });

    it('should return 0 for empty conversations dir', () => {
      const mm = new MemoryManager(tmpDir);
      expect(mm.cleanupOldMemory(30)).toBe(0);
    });
  });
});
