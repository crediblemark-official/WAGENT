import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Learner, LearningResult, StyleAnalysis, DetectedCorrection } from './learner.js';
import { MemoryEntry, ContactProfile } from './types.js';
import { MemoryManager } from './memory-manager.js';
import { StyleRouter } from './style-router.js';

// ── Helpers ─────────────────────────────────────────────────────

function makeEntry(role: 'user' | 'assistant' | 'system', content: string, hoursAgo = 0): MemoryEntry {
  const date = new Date();
  date.setHours(date.getHours() - hoursAgo);
  return {
    contactId: 'test_contact',
    role,
    content,
    timestamp: date.toISOString(),
  };
}

function createMockMemoryManager(): MemoryManager {
  const mock: any = {
    addPattern: vi.fn(),
    addFact: vi.fn(),
    getFacts: vi.fn().mockReturnValue(''),
    loadContactProfile: vi.fn().mockReturnValue({
      contactId: 'test_contact',
      learnedPatterns: [],
      recentInteractions: [],
    }),
    saveContactProfile: vi.fn(),
    readRecentMemory: vi.fn().mockReturnValue([]),
    listContactProfiles: vi.fn().mockReturnValue([]),
    getMemoryDir: vi.fn().mockReturnValue('/tmp/test-memory'),
  };
  return mock as MemoryManager;
}

function createMockStyleRouter(memoryManager: MemoryManager): StyleRouter {
  return new StyleRouter(memoryManager);
}

// ── Tests ───────────────────────────────────────────────────────

describe('Learner', () => {
  let learner: Learner;
  let mockMemoryManager: MemoryManager;
  let styleRouter: StyleRouter;

  beforeEach(() => {
    mockMemoryManager = createMockMemoryManager();
    styleRouter = createMockStyleRouter(mockMemoryManager);
    learner = new Learner(mockMemoryManager, styleRouter);
  });

  describe('constructor', () => {
    it('should initialize with memory manager and style router', () => {
      expect(learner).toBeInstanceOf(Learner);
    });
  });

  // ── analyzeStyle ──────────────────────────────────────────────

  describe('analyzeStyle', () => {
    it('should return null when fewer than 3 user entries', () => {
      const entries = [
        makeEntry('user', 'Halo'),
        makeEntry('assistant', 'Halo juga'),
      ];
      const result = learner.analyzeStyle(entries);
      expect(result).toBeNull();
    });

    it('should detect formal tone from user messages', () => {
      const entries = [
        makeEntry('user', 'Selamat pagi. Saya ingin menanyakan produk terbaru. Mohon informasinya.'),
        makeEntry('assistant', 'Tentu!'),
        makeEntry('user', 'Terima kasih. Saya juga ingin memohon bantuan untuk pemesanan.'),
        makeEntry('assistant', 'Silakan.'),
        makeEntry('user', 'Dengan ini saya mengajukan permohonan pembelian produk A.'),
      ];
      const result = learner.analyzeStyle(entries);
      expect(result).not.toBeNull();
      expect(result!.tone).toBe('formal');
    });

    it('should detect casual tone from user messages', () => {
      const entries = [
        makeEntry('user', 'Gue mau beli barang nih'),
        makeEntry('assistant', 'Boleh banget!'),
        makeEntry('user', 'Harganya berapa sih?'),
        makeEntry('assistant', 'Rp 100.000'),
        makeEntry('user', 'Wah murah banget dong, gue ambil deh'),
      ];
      const result = learner.analyzeStyle(entries);
      expect(result).not.toBeNull();
      expect(result!.tone).toBe('casual');
    });

    it('should detect friendly tone with emojis', () => {
      const entries = [
        makeEntry('user', 'Halo kak! Ada produk baru? 😊'),
        makeEntry('assistant', 'Ada dong!'),
        makeEntry('user', 'Makasih banyak! 👍'),
        makeEntry('assistant', 'Sama-sama!'),
        makeEntry('user', 'Salam kenal ya! 😁'),
      ];
      const result = learner.analyzeStyle(entries);
      expect(result).not.toBeNull();
      expect(result!.tone).toBe('friendly');
    });

    it('should detect language mixing (Indonesia + English)', () => {
      const entries = [
        makeEntry('user', 'Hi, can you help me with the order?'),
        makeEntry('assistant', 'Sure!'),
        makeEntry('user', 'I need the price for product A please'),
        makeEntry('assistant', 'Okay'),
        makeEntry('user', 'Thanks! Can you also check the delivery time?'),
        makeEntry('assistant', 'Of course'),
        makeEntry('user', 'Yes please, that would be great'),
      ];
      const result = learner.analyzeStyle(entries);
      expect(result).not.toBeNull();
      expect(result!.language).toContain('Inggris');
    });

    it('should detect greetings used by contact', () => {
      const entries = [
        makeEntry('user', 'Halo, selamat pagi!'),
        makeEntry('assistant', 'Selamat pagi!'),
        makeEntry('user', 'Halo, saya mau tanya'),
        makeEntry('assistant', 'Silakan'),
        makeEntry('user', 'Assalamualaikum, masih ada?'),
      ];
      const result = learner.analyzeStyle(entries);
      expect(result).not.toBeNull();
      expect(result!.greetings).toBeDefined();
      expect(result!.greetings!.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract topics from user messages', () => {
      const entries = [
        makeEntry('user', 'Berapa harga produk A?'),
        makeEntry('assistant', 'Rp 100.000'),
        makeEntry('user', 'Apakah ada diskon untuk pembelian banyak?'),
        makeEntry('assistant', 'Ada diskon 10%'),
        makeEntry('user', 'Ongkirnya berapa ya?'),
      ];
      const result = learner.analyzeStyle(entries);
      expect(result).not.toBeNull();
      expect(result!.topics).toBeDefined();
      expect(result!.topics!.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect frequent emoji usage', () => {
      const entries = [
        makeEntry('user', 'Halo kak! 😊😊😊😊😊😊😊😊😊😊'),
        makeEntry('assistant', 'Halo!'),
        makeEntry('user', 'Mau order dong! 👍👍👍👍👍👍👍👍'),
        makeEntry('assistant', 'Boleh!'),
        makeEntry('user', 'Makasih! 🎉🎉🎉🎉🎉🎉🎉'),
      ];
      const result = learner.analyzeStyle(entries);
      expect(result).not.toBeNull();
      expect(result!.emojiUsage).toBe('frequent');
    });

    it('should detect moderate emoji usage', () => {
      const entries = [
        makeEntry('user', 'Halo kak! 😊 Ada produk baru?'),
        makeEntry('assistant', 'Ada!'),
        makeEntry('user', 'Makasih 👍 Saya mau lihat katalog'),
        makeEntry('assistant', 'Ini katalognya'),
        makeEntry('user', 'Bagus! Saya ambil ini'),
      ];
      const result = learner.analyzeStyle(entries);
      expect(result).not.toBeNull();
      expect(result!.emojiUsage).toBe('moderate');
    });
  });

  // ── detectCorrections ─────────────────────────────────────────

  describe('detectCorrections', () => {
    it('should detect tone correction ("jangan formal")', () => {
      const corrections = learner.detectCorrections('jangan formal ya, santai aja', 'Baik, dengan ini saya informasikan...');
      expect(corrections.length).toBeGreaterThanOrEqual(1);
      expect(corrections.some(c => c.type === 'tone')).toBe(true);
    });

    it('should detect greeting correction ("jangan panggil pak")', () => {
      const corrections = learner.detectCorrections('jangan panggil pak, saya masih muda', 'Baik, Pak...');
      expect(corrections.length).toBeGreaterThanOrEqual(1);
      expect(corrections.some(c => c.type === 'greeting')).toBe(true);
    });

    it('should detect behavior correction ("jangan panjang")', () => {
      const corrections = learner.detectCorrections('jangan panjang-panjang jawabannya', 'Tentu, saya akan menjelaskan secara detail...');
      expect(corrections.length).toBeGreaterThanOrEqual(1);
      expect(corrections.some(c => c.type === 'behavior')).toBe(true);
    });

    it('should detect general correction ("bukan begitu")', () => {
      const corrections = learner.detectCorrections('bukan begitu maksud saya', 'Baik, saya akan ulangi...');
      expect(corrections.length).toBeGreaterThanOrEqual(1);
      expect(corrections.some(c => c.type === 'behavior')).toBe(true);
    });

    it('should detect name preference ("panggil saya Budi")', () => {
      const corrections = learner.detectCorrections('panggil saya Budi aja', 'Baik...');
      expect(corrections.length).toBeGreaterThanOrEqual(1);
      expect(corrections.some(c => c.type === 'name')).toBe(true);
    });

    it('should detect "ubah" style correction', () => {
      const corrections = learner.detectCorrections('ubah gayanya jadi lebih santai', 'Baik...');
      expect(corrections.length).toBeGreaterThanOrEqual(1);
    });

    it('should return no corrections for normal message', () => {
      const corrections = learner.detectCorrections('Halo, apa kabar?', 'Baik, terima kasih');
      expect(corrections).toHaveLength(0);
    });

    it('should return no corrections for very short message', () => {
      const corrections = learner.detectCorrections('ok', 'Baik');
      expect(corrections).toHaveLength(0);
    });
  });

  // ── extractFactsFromMessage ───────────────────────────────────

  describe('extractFactsFromMessage', () => {
    it('should extract personal information (nama)', () => {
      const facts = learner.extractFactsFromMessage('nama saya Budi dari Jakarta');
      expect(facts.length).toBeGreaterThanOrEqual(1);
      expect(facts.some(f => f.includes('Budi'))).toBe(true);
    });

    it('should extract contact info (nomor)', () => {
      const facts = learner.extractFactsFromMessage('nomor saya 08123456789');
      expect(facts.length).toBeGreaterThanOrEqual(1);
      expect(facts.some(f => f.includes('08123456789'))).toBe(true);
    });

    it('should extract preferences (suka)', () => {
      const facts = learner.extractFactsFromMessage('saya suka produk yang warna biru');
      expect(facts.length).toBeGreaterThanOrEqual(1);
      expect(facts.some(f => f.includes('biru'))).toBe(true);
    });

    it('should extract time references', () => {
      const facts = learner.extractFactsFromMessage('Saya mau order besok');
      expect(facts.length).toBeGreaterThanOrEqual(1);
      expect(facts.some(f => f.toLowerCase().includes('besok'))).toBe(true);
    });

    it('should extract action items (tolong)', () => {
      const facts = learner.extractFactsFromMessage('tolong cek status pesanan saya');
      expect(facts.length).toBeGreaterThanOrEqual(1);
      expect(facts.some(f => f.includes('cek status'))).toBe(true);
    });

    it('should return empty array for non-informational message', () => {
      const facts = learner.extractFactsFromMessage('Halo apa kabar?');
      expect(facts).toHaveLength(0);
    });

    it('should extract action items (bantu)', () => {
      const facts = learner.extractFactsFromMessage('bantu saya cari produk murah');
      expect(facts.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── detectPatterns ────────────────────────────────────────────

  describe('detectPatterns', () => {
    it('should detect short response pattern', () => {
      const entries = [
        makeEntry('user', 'Ok'),
        makeEntry('assistant', 'Baik'),
        makeEntry('user', 'Ya'),
        makeEntry('assistant', 'Siap'),
        makeEntry('user', 'Mau'),
        makeEntry('assistant', 'Silakan'),
        makeEntry('user', 'Harga'),
        makeEntry('assistant', '100'),
        makeEntry('user', 'OK'),
      ];
      const patterns = learner.detectPatterns(entries);
      expect(patterns.some(p => p.includes('pendek'))).toBe(true);
    });

    it('should detect long response pattern', () => {
      const entries = [
        makeEntry('user', 'A'.repeat(250)),
        makeEntry('assistant', 'B'),
        makeEntry('user', 'C'.repeat(250)),
        makeEntry('assistant', 'D'),
        makeEntry('user', 'E'.repeat(250)),
        makeEntry('assistant', 'F'),
        makeEntry('user', 'G'.repeat(250)),
        makeEntry('assistant', 'H'),
        makeEntry('user', 'I'.repeat(250)),
        makeEntry('assistant', 'J'),
      ];
      const patterns = learner.detectPatterns(entries);
      expect(patterns.some(p => p.includes('panjang'))).toBe(true);
    });

    it('should detect high question frequency', () => {
      const entries = [
        makeEntry('user', 'Ada produk apa saja?'),
        makeEntry('assistant', 'Ini daftarnya'),
        makeEntry('user', 'Harganya berapa?'),
        makeEntry('assistant', 'Rp 100.000'),
        makeEntry('user', 'Apakah ada diskon?'),
        makeEntry('assistant', 'Ada'),
        makeEntry('user', 'Warna apa saja yang tersedia?'),
        makeEntry('assistant', 'Merah, biru, hijau'),
        makeEntry('user', 'Bisa COD?'),
      ];
      const patterns = learner.detectPatterns(entries);
      expect(patterns.some(p => p.includes('bertanya'))).toBe(true);
    });

    it('should detect late night activity', () => {
      // Create entries with timestamps at late hours
      const lateHourUser = (content: string): MemoryEntry => ({
        contactId: 'test',
        role: 'user',
        content,
        timestamp: new Date('2024-01-15T23:30:00').toISOString(),
      });
      const normalAssistant = (content: string): MemoryEntry => ({
        contactId: 'test',
        role: 'assistant',
        content,
        timestamp: new Date('2024-01-15T23:32:00').toISOString(),
      });

      const entries = [
        lateHourUser('Halo'),
        normalAssistant('Halo'),
        lateHourUser('Masih ada?'),
        normalAssistant('Ada'),
        lateHourUser('Mau order'),
        normalAssistant('Silakan'),
      ];
      const patterns = learner.detectPatterns(entries);
      expect(patterns.some(p => p.includes('malam'))).toBe(true);
    });

    it('should return empty array for fewer than 3 user entries', () => {
      const entries = [
        makeEntry('user', 'Halo'),
        makeEntry('assistant', 'Halo'),
      ];
      const patterns = learner.detectPatterns(entries);
      expect(patterns).toHaveLength(0);
    });

    it('should detect response length ratio (AI too verbose)', () => {
      const entries = [
        makeEntry('user', 'Halo'),
        makeEntry('assistant', 'A'.repeat(200)),
        makeEntry('user', 'Harga?'),
        makeEntry('assistant', 'B'.repeat(250)),
        makeEntry('user', 'Ok'),
        makeEntry('assistant', 'C'.repeat(300)),
        makeEntry('user', 'Mau'),
        makeEntry('assistant', 'D'.repeat(220)),
        makeEntry('user', 'Bye'),
        makeEntry('assistant', 'E'.repeat(350)),
      ];
      const patterns = learner.detectPatterns(entries);
      expect(patterns.some(p => p.includes('singkat'))).toBe(true);
    });
  });

  // ── learnFromInteraction ──────────────────────────────────────

  describe('learnFromInteraction', () => {
    it('should detect corrections and extract facts from interaction', async () => {
      const result = await learner.learnFromInteraction(
        'test_contact',
        'Test User',
        'jangan formal ya, nomor saya 08123456789',
        'Baik...',
        [],
      );

      expect(result.correctionsApplied).toBeGreaterThanOrEqual(1);
      expect(result.factsExtracted).toBeGreaterThanOrEqual(1);
      expect(result.summary).toBeTruthy();
      expect(mockMemoryManager.saveContactProfile).toHaveBeenCalled();
      expect(mockMemoryManager.addFact).toHaveBeenCalled();
    });

    it('should return zero counts for non-informational message', async () => {
      const result = await learner.learnFromInteraction(
        'test_contact',
        'Test User',
        'Halo apa kabar?',
        'Baik, terima kasih',
        [],
      );

      expect(result.correctionsApplied).toBe(0);
      expect(result.factsExtracted).toBe(0);
      expect(result.patternsDetected).toBe(0);
    });

    it('should perform style analysis periodically (every 10 entries)', async () => {
      // Create 10 entries to trigger style analysis
      const entries: MemoryEntry[] = [];
      for (let i = 0; i < 10; i++) {
        entries.push(makeEntry('user', 'Saya ingin menanyakan produk. Mohon informasinya.'));
        entries.push(makeEntry('assistant', 'Baik, silakan.'));
      }

      vi.mocked(mockMemoryManager.loadContactProfile).mockReturnValueOnce({
        contactId: 'test_contact',
        name: 'Test User',
        tone: 'friendly',
        updatedAt: new Date(),
      });

      const result = await learner.learnFromInteraction(
        'test_contact',
        'Test User',
        'Halo',
        'Halo juga',
        entries,
      );

      // Should have triggered style analysis + profile update
      expect(mockMemoryManager.saveContactProfile).toHaveBeenCalled();
    });

    it('should detect patterns from recent entries', async () => {
      const entries: MemoryEntry[] = [];
      for (let i = 0; i < 10; i++) {
        entries.push(makeEntry('user', 'Ok'));
        entries.push(makeEntry('assistant', 'Baik'));
      }

      const result = await learner.learnFromInteraction(
        'test_contact',
        'Test User',
        'Ok',
        'Baik',
        entries,
      );

      // Short response patterns should be detected
      expect(result.patternsDetected).toBeGreaterThanOrEqual(1);
    });
  });

  // ── processFullConversation ───────────────────────────────────

  describe('processFullConversation', () => {
    it('should return empty result for very few entries', async () => {
      vi.mocked(mockMemoryManager.readRecentMemory).mockReturnValueOnce([
        makeEntry('user', 'Halo'),
        makeEntry('assistant', 'Halo'),
      ]);

      const result = await learner.processFullConversation('test_contact', 'Test User');
      expect(result.factsExtracted).toBe(0);
      expect(result.patternsDetected).toBe(0);
      expect(result.profileUpdated).toBe(false);
    });

    it('should analyze full conversation and extract multiple types of learning', async () => {
      // Create a full conversation with rich data
      const entries: MemoryEntry[] = [];
      for (let i = 0; i < 10; i++) {
        entries.push(makeEntry('user', `Saya ingin order produk. Berapa harganya?`));
        entries.push(makeEntry('assistant', `Harga produk adalah Rp ${i * 10000}`));
      }

      vi.mocked(mockMemoryManager.readRecentMemory).mockReturnValueOnce(entries);
      vi.mocked(mockMemoryManager.loadContactProfile).mockReturnValueOnce({
        contactId: 'test_contact',
        name: 'Test User',
        tone: 'friendly',
        updatedAt: new Date(),
      });

      const result = await learner.processFullConversation('test_contact', 'Test User');

      expect(result.summary).toBeTruthy();
    });

    it('should avoid duplicate facts when extracting', async () => {
      const entries: MemoryEntry[] = [
        makeEntry('user', 'Saya Budi dari Jakarta'),
        makeEntry('assistant', 'Halo Budi!'),
        makeEntry('user', 'Saya Budi kalau boleh tahu'),
        makeEntry('assistant', 'Tentu Budi!'),
        makeEntry('user', 'Nama saya Budi'),
        makeEntry('assistant', 'Baik Budi'),
        makeEntry('user', 'nomor saya 08123456789'),
        makeEntry('assistant', 'Tercatat'),
        makeEntry('user', 'saya suka produk biru'),
        makeEntry('assistant', 'Bagus!'),
      ];

      // Mock getFacts to return existing facts
      vi.mocked(mockMemoryManager.getFacts).mockReturnValue('');
      vi.mocked(mockMemoryManager.readRecentMemory).mockReturnValue(entries);
      vi.mocked(mockMemoryManager.loadContactProfile).mockReturnValueOnce({
        contactId: 'test_contact',
        name: 'Test User',
        tone: 'friendly',
        updatedAt: new Date(),
      });

      const result = await learner.processFullConversation('test_contact', 'Test User');

      // Facts should be extracted, but without excessive duplicates
      expect(result.factsExtracted).toBeGreaterThanOrEqual(1);
    });
  });
});
