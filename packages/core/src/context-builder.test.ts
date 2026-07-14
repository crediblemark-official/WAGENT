import { describe, it, expect } from 'vitest';
import { ContextBuilder } from './context-builder.js';
import { ContextConfig, StyleDirective, ContactProfile, AIMessage } from './types.js';

describe('ContextBuilder', () => {
  const cb = new ContextBuilder();

  const baseProfile: ContactProfile = {
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

  // ── ContextConfig Creation ──────────────────────────────────

  describe('createConfig', () => {
    it('should create a basic config', () => {
      const config = cb.createConfig({
        baseSystemPrompt: 'Kamu adalah CS.',
        contactName: 'Budi',
      });

      expect(config.baseSystemPrompt).toBe('Kamu adalah CS.');
      expect(config.contactName).toBe('Budi');
      expect(config.profile).toBeNull();
      expect(config.isNewConversation).toBeUndefined();
    });

    it('should include profile when provided', () => {
      const config = cb.createConfig({
        baseSystemPrompt: 'Kamu adalah CS.',
        profile: baseProfile,
        contactName: 'Budi',
      });

      expect(config.profile).not.toBeNull();
      expect(config.profile!.name).toBe('Budi Santoso');
      expect(config.profile!.tone).toBe('casual');
    });

    it('should mark new conversations', () => {
      const config = cb.createConfig({
        baseSystemPrompt: 'test',
        isNewConversation: true,
      });

      expect(config.isNewConversation).toBe(true);
    });

    it('should include conversation summary', () => {
      const config = cb.createConfig({
        baseSystemPrompt: 'test',
        conversationSummary: 'User bertanya tentang harga.',
      });

      expect(config.conversationSummary).toBe('User bertanya tentang harga.');
    });

    it('should include skill additions', () => {
      const config = cb.createConfig({
        baseSystemPrompt: 'test',
        systemPromptAdditions: ['Gunakan bahasa Jawa.', 'Jangan sebut harga.'],
      });

      expect(config.systemPromptAdditions).toHaveLength(2);
    });
  });

  // ── System Prompt Building ──────────────────────────────────

  describe('buildSystemPrompt', () => {
    it('should return base prompt when no enrichments', () => {
      const config: ContextConfig = {
        baseSystemPrompt: 'Kamu adalah customer service.',
      };
      const prompt = cb.buildSystemPrompt(config);
      expect(prompt).toContain('Kamu adalah customer service.');
    });

    it('should include relationship context', () => {
      const config: ContextConfig = {
        baseSystemPrompt: 'Kamu adalah CS.',
        profile: baseProfile,
      };
      const prompt = cb.buildSystemPrompt(config);
      expect(prompt).toContain('Teman kuliah');
    });

    it('should include style instructions for casual tone', () => {
      const config: ContextConfig = {
        baseSystemPrompt: 'Kamu adalah CS.',
        profile: baseProfile,
      };
      const prompt = cb.buildSystemPrompt(config);
      expect(prompt).toContain('santai');
      expect(prompt).toContain('Bro');
      expect(prompt).toContain('Gaming');
    });

    it('should include style instructions for formal tone', () => {
      const formalProfile: ContactProfile = {
        contactId: 'bos@s.whatsapp.net',
        name: 'Pak Hendra',
        relationship: 'Atasan',
        tone: 'formal',
        updatedAt: new Date(),
      };
      const config: ContextConfig = {
        baseSystemPrompt: 'Kamu adalah asisten.',
        profile: formalProfile,
      };
      const prompt = cb.buildSystemPrompt(config);
      expect(prompt).toContain('formal');
    });

    it('should include new conversation context', () => {
      const config: ContextConfig = {
        baseSystemPrompt: 'Kamu adalah CS.',
        isNewConversation: true,
        contactName: 'Budi',
      };
      const prompt = cb.buildSystemPrompt(config);
      expect(prompt).toContain('awal percakapan');
      expect(prompt).toContain('Sambut dengan hangat');
    });

    it('should include conversation summary', () => {
      const config: ContextConfig = {
        baseSystemPrompt: 'Kamu adalah CS.',
        conversationSummary: 'User ingin refund.',
      };
      const prompt = cb.buildSystemPrompt(config);
      expect(prompt).toContain('Ringkasan Percakapan');
      expect(prompt).toContain('refund');
    });

    it('should include skill additions', () => {
      const config: ContextConfig = {
        baseSystemPrompt: 'Kamu adalah CS.',
        systemPromptAdditions: ['Gunakan bahasa sopan.'],
      };
      const prompt = cb.buildSystemPrompt(config);
      expect(prompt).toContain('Panduan Tambahan');
      expect(prompt).toContain('Gunakan bahasa sopan');
    });

    it('should include contact name in info section', () => {
      const config: ContextConfig = {
        baseSystemPrompt: 'Kamu adalah CS.',
        contactName: 'Budi Santoso',
      };
      const prompt = cb.buildSystemPrompt(config);
      expect(prompt).toContain('Budi Santoso');
    });
  });

  // ── Message Building ────────────────────────────────────────

  describe('buildMessages', () => {
    it('should build messages array with system + history + user', () => {
      const config: ContextConfig = {
        baseSystemPrompt: 'Kamu adalah CS.',
      };
      const history: AIMessage[] = [
        { role: 'assistant', content: 'Halo, ada yang bisa dibantu?' },
      ];
      const messages = cb.buildMessages(config, history, 'Ada promo?');

      expect(messages).toHaveLength(3);
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('Kamu adalah CS.');
      expect(messages[1].role).toBe('assistant');
      expect(messages[2].role).toBe('user');
      expect(messages[2].content).toBe('Ada promo?');
    });

    it('should work with empty history', () => {
      const config: ContextConfig = {
        baseSystemPrompt: 'Kamu adalah CS.',
        isNewConversation: true,
        contactName: 'Budi',
      };
      const messages = cb.buildMessages(config, [], 'Halo');
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('awal percakapan');
    });
  });

  // ── Quick Summary ──────────────────────────────────────────

  describe('generateQuickSummary', () => {
    it('should return empty for no entries', async () => {
      const summary = await cb.generateQuickSummary([]);
      expect(summary).toBe('');
    });

    it('should include recent entries', async () => {
      const entries = [
        { contactId: 'user', role: 'user' as const, content: 'Halo', timestamp: new Date().toISOString() },
        { contactId: 'user', role: 'assistant' as const, content: 'Halo juga!', timestamp: new Date().toISOString() },
      ];
      const summary = await cb.generateQuickSummary(entries);
      expect(summary).toContain('Halo');
      expect(summary).toContain('Halo juga');
    });

    it('should handle many entries', async () => {
      const entries = Array.from({ length: 20 }, (_, i) => ({
        contactId: 'user',
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `Pesan ${i}`,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      }));
      const summary = await cb.generateQuickSummary(entries);
      expect(summary).toContain('Percakapan dimulai dengan');
      expect(summary).toContain('Pesan terbaru');
    });
  });
});
