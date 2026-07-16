import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextBuilder } from '../agent/context-builder.js';
import { ContextConfig, MemoryEntry, ContactProfile } from '../types.js';

vi.mock('../utils/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  }),
}));

const mockCBConfig = {
  section_relationship: 'Hubungan',
  section_style: 'Gaya Komunikasi',
  section_contact: 'Informasi Kontak',
  section_new_conversation: 'Konteks Baru',
  section_summary: 'Ringkasan',
  section_additions: 'Panduan Tambahan',
  label_relationship: 'Hubungan',
  label_contact: 'Kontak',
  label_new_conversation: 'Ini adalah percakapan baru.',
  style_language: 'Bahasa',
  style_greetings: 'Sapaan',
  style_topics: 'Topik',
  style_examples: 'Contoh',
};

vi.mock('../agent/prompt-loader.js', () => ({
  promptLoader: {
    getContextBuilderConfig: () => mockCBConfig,
  },
}));

vi.mock('../utils/style-descriptions.js', () => ({
  TONE_INSTRUCTIONS: {
    casual: 'Gunakan bahasa santai dan natural.',
    formal: 'Gunakan bahasa formal dan sopan.',
    professional: 'Gunakan bahasa profesional.',
    friendly: 'Gunakan bahasa ramah dan hangat.',
    mixed: 'Sesuaikan dengan lawan bicara.',
  },
  EMOJI_INSTRUCTIONS: {
    rare: 'Hindari penggunaan emoji.',
    moderate: 'Gunakan emoji secukupnya.',
    frequent: 'Gunakan emoji dengan bebas.',
  },
}));

function makeProfile(overrides?: Partial<ContactProfile>): ContactProfile {
  return {
    contactId: '123',
    name: 'Budi',
    tone: 'casual',
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<ContextConfig>): ContextConfig {
  return {
    baseSystemPrompt: 'Kamu adalah asisten AI.',
    ...overrides,
  };
}

describe('ContextBuilder', () => {
  let builder: ContextBuilder;

  beforeEach(() => {
    builder = new ContextBuilder();
  });

  describe('buildSystemPrompt', () => {
    it('should return base prompt only', () => {
      const config = makeConfig();
      const result = builder.buildSystemPrompt(config);
      expect(result).toBe('Kamu adalah asisten AI.');
    });

    it('should include contact profile style instructions', () => {
      const profile = makeProfile({
        tone: 'formal',
        language: 'Indonesia',
        greetings: ['Halo', 'Selamat pagi'],
        emojiUsage: 'moderate',
        topics: ['order', 'pengiriman'],
        exampleResponses: ['Halo, ada yang bisa dibantu?', 'Pesanan Anda sedang diproses.'],
      });
      const config = makeConfig({ profile });
      const result = builder.buildSystemPrompt(config);

      expect(result).toContain('Kamu adalah asisten AI.');
      expect(result).toContain('## Gaya Komunikasi');
      expect(result).toContain('Gunakan bahasa formal dan sopan.');
      expect(result).toContain('Bahasa: Indonesia');
      expect(result).toContain('Sapaan: Halo, Selamat pagi');
      expect(result).toContain('Gunakan emoji secukupnya.');
      expect(result).toContain('Topik: order, pengiriman');
      expect(result).toContain('Contoh:');
      expect(result).toContain('> Halo, ada yang bisa dibantu?');
      expect(result).toContain('> Pesanan Anda sedang diproses.');
    });

    it('should include relationship context', () => {
      const profile = makeProfile({ relationship: 'Customer VIP' });
      const config = makeConfig({ profile });
      const result = builder.buildSystemPrompt(config);

      expect(result).toContain('## Hubungan');
      expect(result).toContain('Hubungan: Customer VIP');
    });

    it('should include contact name', () => {
      const config = makeConfig({ contactName: 'Budi Santoso' });
      const result = builder.buildSystemPrompt(config);

      expect(result).toContain('## Informasi Kontak');
      expect(result).toContain('Kontak: Budi Santoso');
    });

    it('should include new conversation context', () => {
      const config = makeConfig({ isNewConversation: true });
      const result = builder.buildSystemPrompt(config);

      expect(result).toContain('## Konteks Baru');
      expect(result).toContain('Ini adalah percakapan baru.');
    });

    it('should include conversation summary', () => {
      const config = makeConfig({ conversationSummary: 'User menanyakan status order #1234.' });
      const result = builder.buildSystemPrompt(config);

      expect(result).toContain('## Ringkasan');
      expect(result).toContain('User menanyakan status order #1234.');
    });

    it('should include system prompt additions', () => {
      const config = makeConfig({
        systemPromptAdditions: ['Gunakan tool search untuk mencari produk.', 'Jangan asumsi stok.'],
      });
      const result = builder.buildSystemPrompt(config);

      expect(result).toContain('## Panduan Tambahan');
      expect(result).toContain('Gunakan tool search untuk mencari produk.');
      expect(result).toContain('Jangan asumsi stok.');
    });

    it('should truncate when exceeding max length', () => {
      const shortBuilder = new ContextBuilder({ maxSystemPromptLength: 50 });
      const config = makeConfig({ baseSystemPrompt: 'A'.repeat(100) });
      const result = shortBuilder.buildSystemPrompt(config);

      expect(result.length).toBe(50);
      expect(result).toBe('A'.repeat(50));
    });

    it('should combine all sections in correct order', () => {
      const profile = makeProfile({ relationship: 'Teman' });
      const config = makeConfig({
        profile,
        contactName: 'Andi',
        isNewConversation: true,
        conversationSummary: 'Sebelumnya membahas harga.',
        systemPromptAdditions: ['Gunakan tool XYZ.'],
      });
      const result = builder.buildSystemPrompt(config);

      const baseIdx = result.indexOf('Kamu adalah asisten AI.');
      const relIdx = result.indexOf('## Hubungan');
      const styleIdx = result.indexOf('## Gaya Komunikasi');
      const contactIdx = result.indexOf('## Informasi Kontak');
      const newConvIdx = result.indexOf('## Konteks Baru');
      const summaryIdx = result.indexOf('## Ringkasan');
      const additionsIdx = result.indexOf('## Panduan Tambahan');

      expect(baseIdx).toBe(0);
      expect(relIdx).toBeGreaterThan(baseIdx);
      expect(styleIdx).toBeGreaterThan(relIdx);
      expect(contactIdx).toBeGreaterThan(styleIdx);
      expect(newConvIdx).toBeGreaterThan(contactIdx);
      expect(summaryIdx).toBeGreaterThan(newConvIdx);
      expect(additionsIdx).toBeGreaterThan(summaryIdx);
    });

    it('should handle null profile gracefully', () => {
      const config = makeConfig({ profile: null });
      const result = builder.buildSystemPrompt(config);
      expect(result).toBe('Kamu adalah asisten AI.');
    });

    it('should handle profile with no optional fields', () => {
      const profile = makeProfile();
      const config = makeConfig({ profile });
      const result = builder.buildSystemPrompt(config);

      expect(result).toContain('## Gaya Komunikasi');
      expect(result).toContain('Gunakan bahasa santai dan natural.');
      expect(result).not.toContain('Bahasa:');
      expect(result).not.toContain('Sapaan:');
      expect(result).not.toContain('Topik:');
      expect(result).not.toContain('Contoh:');
    });

    it('should limit examples to 3', () => {
      const profile = makeProfile({
        exampleResponses: ['Ex1', 'Ex2', 'Ex3', 'Ex4', 'Ex5'],
      });
      const config = makeConfig({ profile });
      const result = builder.buildSystemPrompt(config);

      expect(result).toContain('> Ex1');
      expect(result).toContain('> Ex2');
      expect(result).toContain('> Ex3');
      expect(result).not.toContain('> Ex4');
      expect(result).not.toContain('> Ex5');
    });
  });

  describe('buildMessages', () => {
    it('should return system + history + user message', () => {
      const config = makeConfig();
      const history = [
        { role: 'user' as const, content: 'Halo' },
        { role: 'assistant' as const, content: 'Halo! Ada yang bisa dibantu?' },
      ];
      const messages = builder.buildMessages(config, history, 'Cek pesanan saya');

      expect(messages).toHaveLength(4);
      expect(messages[0]).toEqual({ role: 'system', content: 'Kamu adalah asisten AI.' });
      expect(messages[1]).toEqual({ role: 'user', content: 'Halo' });
      expect(messages[2]).toEqual({ role: 'assistant', content: 'Halo! Ada yang bisa dibantu?' });
      expect(messages[3]).toEqual({ role: 'user', content: 'Cek pesanan saya' });
    });

    it('should work with empty history', () => {
      const config = makeConfig();
      const messages = builder.buildMessages(config, [], 'Halo');

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[1]).toEqual({ role: 'user', content: 'Halo' });
    });

    it('should include enriched system prompt when profile provided', () => {
      const config = makeConfig({ profile: makeProfile({ tone: 'formal' }) });
      const messages = builder.buildMessages(config, [], 'Test');

      expect(messages[0].content).toContain('Gaya Komunikasi');
    });
  });

  describe('createConfig', () => {
    it('should return a ContextConfig with provided params', () => {
      const profile = makeProfile();
      const config = builder.createConfig({
        baseSystemPrompt: 'Test prompt',
        profile,
        systemPromptAdditions: ['Add 1'],
        conversationSummary: 'Summary here',
        contactName: 'Andi',
        isNewConversation: true,
      });

      expect(config.baseSystemPrompt).toBe('Test prompt');
      expect(config.profile).toBe(profile);
      expect(config.systemPromptAdditions).toEqual(['Add 1']);
      expect(config.conversationSummary).toBe('Summary here');
      expect(config.contactName).toBe('Andi');
      expect(config.isNewConversation).toBe(true);
    });

    it('should use defaults for missing optional params', () => {
      const config = builder.createConfig({ baseSystemPrompt: 'Prompt' });

      expect(config.profile).toBeNull();
      expect(config.systemPromptAdditions).toEqual([]);
      expect(config.conversationSummary).toBeUndefined();
      expect(config.contactName).toBeUndefined();
      expect(config.isNewConversation).toBeUndefined();
    });
  });

  describe('generateQuickSummary', () => {
    it('should return empty string for empty entries', async () => {
      const result = await builder.generateQuickSummary([]);
      expect(result).toBe('');
    });

    it('should use summarizer when available', async () => {
      const mockSummarizer = {
        summarize: vi.fn().mockResolvedValue('Abstractive summary'),
      };
      const builderWithSummarizer = new ContextBuilder({
        summarizer: mockSummarizer as any,
      });

      const entries: MemoryEntry[] = [
        { contactId: 'c1', role: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00Z' },
      ];
      const result = await builderWithSummarizer.generateQuickSummary(entries);

      expect(result).toBe('Abstractive summary');
      expect(mockSummarizer.summarize).toHaveBeenCalledWith(entries, 300);
    });

    it('should fall back to extractive when summarizer fails', async () => {
      const mockSummarizer = {
        summarize: vi.fn().mockRejectedValue(new Error('AI failed')),
      };
      const builderWithSummarizer = new ContextBuilder({
        summarizer: mockSummarizer as any,
      });

      const entries: MemoryEntry[] = [
        { contactId: 'c1', role: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00Z' },
      ];
      const result = await builderWithSummarizer.generateQuickSummary(entries);

      expect(result).not.toBe('');
      expect(typeof result).toBe('string');
    });

    it('should fall back to extractive when summarizer returns empty', async () => {
      const mockSummarizer = {
        summarize: vi.fn().mockResolvedValue(''),
      };
      const builderWithSummarizer = new ContextBuilder({
        summarizer: mockSummarizer as any,
      });

      const entries: MemoryEntry[] = [
        { contactId: 'c1', role: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00Z' },
      ];
      const result = await builderWithSummarizer.generateQuickSummary(entries);

      expect(result).not.toBe('');
    });

    it('should use extractive fallback without summarizer', async () => {
      const entries: MemoryEntry[] = [
        { contactId: 'c1', role: 'user', content: 'Pertanyaan tentang order', timestamp: '2026-01-01T00:00:00Z' },
        { contactId: 'c1', role: 'assistant', content: 'Order Anda sedang diproses', timestamp: '2026-01-01T00:01:00Z' },
      ];
      const result = await builder.generateQuickSummary(entries);

      expect(result).not.toBe('');
      expect(typeof result).toBe('string');
    });

    it('should respect maxLength parameter', async () => {
      const mockSummarizer = {
        summarize: vi.fn().mockResolvedValue('Summary'),
      };
      const builderWithSummarizer = new ContextBuilder({
        summarizer: mockSummarizer as any,
      });

      const entries: MemoryEntry[] = [
        { contactId: 'c1', role: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00Z' },
      ];
      await builderWithSummarizer.generateQuickSummary(entries, 100);

      expect(mockSummarizer.summarize).toHaveBeenCalledWith(entries, 100);
    });
  });
});
