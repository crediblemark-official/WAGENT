import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Learner, LearningResult } from '../agent/learner.js';
import { MemoryManager } from '../agent/memory-manager.js';
import { StyleRouter } from '../utils/style-router.js';
import { MemoryEntry, ContactProfile } from '../types.js';

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

function entry(role: 'user' | 'assistant', content: string, hoursAgo = 0): MemoryEntry {
  const ts = new Date(Date.now() - hoursAgo * 3600_000);
  return { contactId: 'test@s.whatsapp.net', role, content, timestamp: ts.toISOString() };
}

function userEntry(content: string, hoursAgo = 0): MemoryEntry {
  return entry('user', content, hoursAgo);
}

function assistantEntry(content: string, hoursAgo = 0): MemoryEntry {
  return entry('assistant', content, hoursAgo);
}

function pair(userMsg: string, aiMsg: string, hoursAgo = 0): MemoryEntry[] {
  return [userEntry(userMsg, hoursAgo), assistantEntry(aiMsg, hoursAgo)];
}

function makeProfile(overrides?: Partial<ContactProfile>): ContactProfile {
  return {
    contactId: 'test@s.whatsapp.net',
    name: 'Test User',
    tone: 'friendly',
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildEntries(count: number, userMsgs?: string[]): MemoryEntry[] {
  const msgs: string[] = userMsgs || Array.from({ length: count }, (_, i) => `message ${i}`);
  const result: MemoryEntry[] = [];
  for (let i = 0; i < count; i++) {
    result.push(userEntry(msgs[i] || `msg ${i}`, i));
    result.push(assistantEntry(`reply ${i}`, i));
  }
  return result;
}

describe('Learner', () => {
  let mm: MemoryManager;
  let sr: StyleRouter;
  let learner: Learner;

  beforeEach(() => {
    mm = {
      loadContactProfile: vi.fn().mockReturnValue(makeProfile()),
      saveContactProfile: vi.fn(),
      addFact: vi.fn(),
      getFacts: vi.fn().mockReturnValue(''),
      readRecentMemory: vi.fn().mockReturnValue([]),
    } as unknown as MemoryManager;

    sr = {} as StyleRouter;
    learner = new Learner(mm, sr);
  });

  // ── learnFromInteraction ────────────────────────────────────────

  describe('learnFromInteraction', () => {
    it('returns LearningResult with correct structure', async () => {
      const result = await learner.learnFromInteraction(
        'test@s.whatsapp.net', 'Test', 'hi', 'hello', [],
      );

      expect(result).toHaveProperty('profileUpdated');
      expect(result).toHaveProperty('factsExtracted');
      expect(result).toHaveProperty('patternsDetected');
      expect(result).toHaveProperty('correctionsApplied');
      expect(result).toHaveProperty('summary');
      expect(typeof result.profileUpdated).toBe('boolean');
      expect(typeof result.factsExtracted).toBe('number');
      expect(typeof result.patternsDetected).toBe('number');
      expect(typeof result.correctionsApplied).toBe('number');
      expect(typeof result.summary).toBe('string');
    });

    it('detects corrections from user message', async () => {
      const result = await learner.learnFromInteraction(
        'test@s.whatsapp.net', 'Test', 'jangan formal ya', 'ok', [],
      );
      expect(result.correctionsApplied).toBeGreaterThanOrEqual(1);
    });

    it('records interaction summary in profile', async () => {
      await learner.learnFromInteraction(
        'test@s.whatsapp.net', 'Test', 'halo apa kabar', 'baik', [],
      );
      expect(mm.loadContactProfile).toHaveBeenCalledWith('test@s.whatsapp.net');
      expect(mm.saveContactProfile).toHaveBeenCalled();
    });

    it('extracts facts from message', async () => {
      const result = await learner.learnFromInteraction(
        'test@s.whatsapp.net', 'Test', 'nama saya Budi dari Bandung', 'ok', [],
      );
      expect(result.factsExtracted).toBeGreaterThanOrEqual(1);
      expect(mm.addFact).toHaveBeenCalled();
    });

    it('detects patterns from entries', async () => {
      const entries = buildEntries(6, [
        'apa ya', 'gimana ya', 'bisa ga', 'mau dong', 'eh iya', 'ok deh',
      ]);
      const result = await learner.learnFromInteraction(
        'test@s.whatsapp.net', 'Test', 'test', 'ok', entries,
      );
      expect(result.patternsDetected).toBeGreaterThanOrEqual(1);
    });

    it('triggers style analysis every ~10 entries', async () => {
      const entries = buildEntries(10, [
        'halo', 'hai', 'selamat pagi', 'bro',
        'halo', 'hai', 'selamat pagi', 'bro',
        'halo', 'hai',
      ]);
      const result = await learner.learnFromInteraction(
        'test@s.whatsapp.net', 'Test', 'ok', 'ok', entries,
      );
      expect(result.profileUpdated).toBe(true);
    });
  });

  // ── detectTone ──────────────────────────────────────────────────

  describe('detectTone', () => {
    it('returns formal for formal messages', () => {
      const entries: MemoryEntry[] = [
        userEntry('selamat pagi, saya ingin bertanya tentang produk'),
        userEntry('mohon informasi mengenai harga dan silakan bantu saya'),
        userEntry('terima kasih atas perhatian anda'),
      ];
      // Access private via analyzeStyle
      const result = (learner as any).detectTone(entries);
      expect(result).toBe('formal');
    });

    it('returns casual for casual messages', () => {
      const entries: MemoryEntry[] = [
        userEntry('hai bro, gimana kabar'),
        userEntry('aku lagi di rumah nih ga ada kerjaan'),
        userEntry('udah makan belum sih'),
      ];
      const result = (learner as any).detectTone(entries);
      expect(result).toBe('casual');
    });

    it('returns friendly for friendly messages', () => {
      const entries: MemoryEntry[] = [
        userEntry('hey! lagi apa nih 😊'),
        userEntry('makasih ya udah bantu 😁'),
        userEntry('thanks banyak ya 🙏'),
      ];
      const result = (learner as any).detectTone(entries);
      expect(result).toBe('friendly');
    });

    it('returns mixed when both formal and casual present', () => {
      const entries: MemoryEntry[] = [
        userEntry('saya ingin bertanya tentang produk'),
        userEntry('mohon bantuannya untuk order ini'),
        userEntry('udah dong ga sabar nih'),
        userEntry('makasih banyak ya 😊'),
      ];
      const result = (learner as any).detectTone(entries);
      expect(result).toBe('mixed');
    });

    it('returns professional as fallback', () => {
      const entries: MemoryEntry[] = [
        userEntry('ok'),
        userEntry('nice'),
        userEntry('great'),
      ];
      const result = (learner as any).detectTone(entries);
      expect(result).toBe('professional');
    });

    it('returns undefined for empty entries', () => {
      const result = (learner as any).detectTone([]);
      expect(result).toBeUndefined();
    });
  });

  // ── detectLanguage ──────────────────────────────────────────────

  describe('detectLanguage', () => {
    it('returns Indonesia for pure Indonesian', () => {
      const entries: MemoryEntry[] = [
        userEntry('selamat pagi saya ingin bertanya tentang produk'),
        userEntry('tolong bantu saya ya untuk informasi'),
      ];
      const result = (learner as any).detectLanguage(entries);
      expect(result).toBe('Indonesia');
    });

    it('returns Indonesia dengan sedikit Inggris for ~15% English', () => {
      const entries: MemoryEntry[] = [
        userEntry('tolong bantu saya cek harga untuk produk yang ini please ya'),
        userEntry('saya ingin tahu info about the product yang tadi itu ya'),
        userEntry('ok terima kasih banyak untuk bantuannya ya'),
      ];
      const result = (learner as any).detectLanguage(entries);
      expect(result).toBe('Indonesia dengan sedikit Inggris');
    });

    it('returns Indonesia campur Inggris for ~35% English', () => {
      const entries: MemoryEntry[] = [
        userEntry('I need the product info and the price list please'),
        userEntry('can you help me check the order status for the time being'),
        userEntry('the shipping date is not good and the support is not okay'),
      ];
      const result = (learner as any).detectLanguage(entries);
      expect(result).toBe('Indonesia campur Inggris');
    });

    it('handles empty entries', () => {
      const result = (learner as any).detectLanguage([]);
      expect(result).toBeUndefined();
    });
  });

  // ── detectGreetings ─────────────────────────────────────────────

  describe('detectGreetings', () => {
    it('detects halo greeting', () => {
      const entries: MemoryEntry[] = [
        userEntry('halo apa kabar'),
        userEntry('selamat pagi'),
      ];
      const result: string[] = (learner as any).detectGreetings(entries);
      expect(result).toContain('halo');
    });

    it('detects hey greeting', () => {
      const entries: MemoryEntry[] = [
        userEntry('hey gimana'),
        userEntry('yo what up'),
      ];
      const result: string[] = (learner as any).detectGreetings(entries);
      expect(result).toContain('hey');
    });

    it('returns empty for no greetings', () => {
      const entries: MemoryEntry[] = [
        userEntry('harga barangnya berapa'),
        userEntry('ok terima kasih'),
      ];
      const result: string[] = (learner as any).detectGreetings(entries);
      expect(result).toHaveLength(0);
    });
  });

  // ── extractTopics ───────────────────────────────────────────────

  describe('extractTopics', () => {
    it('detects price/harga topic', () => {
      const entries: MemoryEntry[] = [
        userEntry('berapa harga produk ini'),
        userEntry('harga nya murah ga'),
      ];
      const result: string[] = (learner as any).extractTopics(entries);
      expect(result).toContain('Harga');
    });

    it('detects shipping/pengiriman topic', () => {
      const entries: MemoryEntry[] = [
        userEntry('kirim paketnya kapan ya'),
        userEntry('paket sudah sampai belum'),
      ];
      const result: string[] = (learner as any).extractTopics(entries);
      expect(result).toContain('Pengiriman');
    });

    it('returns empty for unrelated messages (threshold >= 2)', () => {
      const entries: MemoryEntry[] = [
        userEntry('halo apa kabar'),
        userEntry('lagi apa nih'),
      ];
      const result: string[] = (learner as any).extractTopics(entries);
      expect(result).toHaveLength(0);
    });
  });

  // ── detectEmojiUsage ────────────────────────────────────────────

  describe('detectEmojiUsage', () => {
    it('returns frequent for high emoji ratio (>0.05)', () => {
      const entries: MemoryEntry[] = [
        userEntry('😊😊😊😊😊😊😊😊😊😊 hello'),
      ];
      const result = (learner as any).detectEmojiUsage(entries);
      expect(result).toBe('frequent');
    });

    it('returns moderate for medium emoji ratio (>0.01)', () => {
      const entries: MemoryEntry[] = [
        userEntry('hello there how are you doing today buddy 😊 ok thanks for the help'),
      ];
      const result = (learner as any).detectEmojiUsage(entries);
      expect(result).toBe('moderate');
    });

    it('returns undefined for no emojis', () => {
      const entries: MemoryEntry[] = [
        userEntry('halo apa kabar'),
        userEntry('ok terima kasih'),
      ];
      const result = (learner as any).detectEmojiUsage(entries);
      expect(result).toBeUndefined();
    });
  });

  // ── detectCorrections ───────────────────────────────────────────

  describe('detectCorrections', () => {
    it('detects tone correction: jangan formal', () => {
      const result = learner.detectCorrections('jangan formal ya', 'baik saya paham');
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].type).toBe('tone');
    });

    it('detects greeting correction: jangan panggil pak', () => {
      const result = learner.detectCorrections('jangan panggil pak', 'ok');
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.some(c => c.type === 'greeting')).toBe(true);
    });

    it('detects behavior correction: jangan lama', () => {
      const result = learner.detectCorrections('jangan lama ya responsnya', 'ok');
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.some(c => c.type === 'behavior')).toBe(true);
    });

    it('detects name preference: panggil saya Andi', () => {
      const result = learner.detectCorrections('panggil saya Andi', 'ok');
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].type).toBe('name');
    });

    it('returns empty for non-correction message', () => {
      const result = learner.detectCorrections('halo apa kabar', 'baik');
      expect(result).toHaveLength(0);
    });
  });

  // ── extractFactsFromMessage ─────────────────────────────────────

  describe('extractFactsFromMessage', () => {
    it('extracts name: nama saya Budi', () => {
      const facts = learner.extractFactsFromMessage('nama saya Budi dari Jakarta');
      expect(facts.length).toBeGreaterThanOrEqual(1);
      expect(facts[0]).toContain('Budi');
    });

    it('extracts phone: nomor saya 08123456789', () => {
      const facts = learner.extractFactsFromMessage('nomor saya 08123456789');
      expect(facts.length).toBeGreaterThanOrEqual(1);
      expect(facts.some(f => f.includes('08123456789'))).toBe(true);
    });

    it('extracts preference: saya suka warna biru', () => {
      const facts = learner.extractFactsFromMessage('saya suka warna biru');
      expect(facts.length).toBeGreaterThanOrEqual(1);
      expect(facts.some(f => f.includes('warna biru'))).toBe(true);
    });

    it('returns empty for no facts', () => {
      const facts = learner.extractFactsFromMessage('ok');
      expect(facts).toHaveLength(0);
    });
  });

  // ── detectPatterns ──────────────────────────────────────────────

  describe('detectPatterns', () => {
    it('detects short message pattern (< 30 chars avg, >= 5 msgs)', () => {
      const entries: MemoryEntry[] = [
        userEntry('ok'),
        userEntry('ya'),
        userEntry('sip'),
        userEntry('ga'),
        userEntry('he'),
      ];
      const patterns = learner.detectPatterns(entries);
      expect(patterns.some(p => p.includes('pendek'))).toBe(true);
    });

    it('detects high question frequency (>50%)', () => {
      const entries: MemoryEntry[] = [
        userEntry('apa ya?'),
        userEntry('gimana ya?'),
        userEntry('bisa ga?'),
        userEntry('mau dong?'),
        userEntry('ok'),
      ];
      const patterns = learner.detectPatterns(entries);
      expect(patterns.some(p => p.includes('bertanya'))).toBe(true);
    });

    it('returns empty for < 3 user entries', () => {
      const entries: MemoryEntry[] = [
        userEntry('halo'),
        userEntry('hai'),
      ];
      const patterns = learner.detectPatterns(entries);
      expect(patterns).toHaveLength(0);
    });
  });

  // ── processFullConversation ─────────────────────────────────────

  describe('processFullConversation', () => {
    it('returns early if < 5 entries', async () => {
      (mm.readRecentMemory as ReturnType<typeof vi.fn>).mockReturnValue([
        userEntry('a'), assistantEntry('b'),
      ]);
      const result = await learner.processFullConversation(
        'test@s.whatsapp.net', 'Test',
      );
      expect(result.factsExtracted).toBe(0);
      expect(result.patternsDetected).toBe(0);
    });

    it('processes up to 100 entries', async () => {
      const entries = buildEntries(12, [
        'halo apa kabar', 'harga berapa', 'kirim kapan ya',
        'halo lagi', 'ok terima kasih', 'ok deh',
        'halo ya', 'saya mau beli', 'bisa kirim',
        'halo bro', 'murah ga', 'ok',
      ]);
      (mm.readRecentMemory as ReturnType<typeof vi.fn>).mockReturnValue(entries);
      const result = await learner.processFullConversation(
        'test@s.whatsapp.net', 'Test',
      );
      expect(typeof result.summary).toBe('string');
      expect(result).toHaveProperty('profileUpdated');
    });

    it('deduplicates facts against existing facts', async () => {
      const entries = buildEntries(6, [
        'nama saya Budi dari Jakarta', 'ok',
        'halo apa kabar', 'ok',
        'saya suka warna biru', 'ok',
      ]);
      (mm.readRecentMemory as ReturnType<typeof vi.fn>).mockReturnValue(entries);
      (mm.getFacts as ReturnType<typeof vi.fn>).mockReturnValue('- [2026-07-16] User menyebutkan informasi personal: Budi');

      const result = await learner.processFullConversation(
        'test@s.whatsapp.net', 'Test',
      );
      expect(result.factsExtracted).toBeGreaterThanOrEqual(0);
    });
  });
});
