import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { PromptGenerator } from '../prompt-generator.js';
import { WAgentConfig } from '../types.js';

vi.mock('../logger.js', () => ({
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

const TMP = join(import.meta.dirname, '_prompt_gen_test_tmp');

const defaultAnswers = {
  businessName: 'Toko Budi',
  businessType: 'E-commerce Fashion',
  businessDescription: 'Toko online yang menjual baju dan aksesoris.',
  targetCustomer: 'Remaja dan dewasa muda',
  tone: 'friendly' as const,
  emojiUsage: 'frequent' as const,
  language: 'Indonesia',
  greeting: 'Halo Kak!',
  frequentQuestions: ['Berapa harga kaos?', 'Ada diskon?', 'Bisa COD?'],
  orderProcess: 'Order via WhatsApp, bayar, kirim',
  paymentMethods: 'Transfer, QRIS, COD',
  shippingTime: '2-3 hari kerja',
  returnPolicy: 'Retur dalam 7 hari jika rusak',
  forbiddenActions: ['memberikan data pribadi orang lain'],
  escalationTriggers: ['komplain keras', 'refund'],
  workingHours: '08:00-17:00',
  features: ['hitung_ongkir', 'bayar', 'cek_pesanan'],
  welcomeMessage: 'Halo! Ada yang bisa dibantu?',
  errorMessage: 'Terjadi error.',
  offlineMessage: 'Luar jam kerja.',
};

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('PromptGenerator', () => {
  describe('generateAll', () => {
    it('should create all 4 prompt files', async () => {
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const gen = new PromptGenerator({} as WAgentConfig);
        await gen.generateAll(defaultAnswers);

        expect(existsSync(join(TMP, 'prompts', 'system.toon'))).toBe(true);
        expect(existsSync(join(TMP, 'prompts', 'personality.toon'))).toBe(true);
        expect(existsSync(join(TMP, 'prompts', 'messages.toon'))).toBe(true);
        expect(existsSync(join(TMP, 'prompts', 'skills.toon'))).toBe(true);
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should generate correct system.toon content', async () => {
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const gen = new PromptGenerator({} as WAgentConfig);
        await gen.generateAll(defaultAnswers);

        const content = readFileSync(join(TMP, 'prompts', 'system.toon'), 'utf-8');
        expect(content).toContain('role: e-commerce-fashion-ai');
        expect(content).toContain('language: Indonesia');
        expect(content).toContain('style: friendly');
        expect(content).toContain('Toko Budi');
        expect(content).toContain('Halo Kak!');
        expect(content).toContain('Jangan memberikan data pribadi orang lain');
        expect(content).toContain('Eskalasi ke manusia jika: komplain keras, refund');
        expect(content).toContain('reminder:');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should generate correct personality.toon content', async () => {
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const gen = new PromptGenerator({} as WAgentConfig);
        await gen.generateAll(defaultAnswers);

        const content = readFileSync(join(TMP, 'prompts', 'personality.toon'), 'utf-8');
        expect(content).toContain('tones:');
        expect(content).toContain('casual:');
        expect(content).toContain('formal:');
        expect(content).toContain('professional:');
        expect(content).toContain('friendly:');
        expect(content).toContain('mixed:');
        expect(content).toContain('emoji:');
        expect(content).toContain('rare:');
        expect(content).toContain('moderate:');
        expect(content).toContain('frequent:');
        expect(content).toContain('context:');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should generate correct messages.toon content', async () => {
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const gen = new PromptGenerator({} as WAgentConfig);
        await gen.generateAll(defaultAnswers);

        const content = readFileSync(join(TMP, 'prompts', 'messages.toon'), 'utf-8');
        expect(content).toContain('welcome: Halo! Ada yang bisa dibantu?');
        expect(content).toContain('rate_limit: Mohon tunggu sebentar ya.');
        expect(content).toContain('offline: Luar jam kerja.');
        expect(content).toContain('error_technical: Terjadi error.');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should generate correct skills.toon content', async () => {
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const gen = new PromptGenerator({} as WAgentConfig);
        await gen.generateAll(defaultAnswers);

        const content = readFileSync(join(TMP, 'prompts', 'skills.toon'), 'utf-8');
        expect(content).toContain('shipping:');
        expect(content).toContain('hitung_ongkir');
        expect(content).toContain('payment:');
        expect(content).toContain('bayar');
        expect(content).toContain('order:');
        expect(content).toContain('Kamu bisa mengecek status pesanan');
        expect(content).toContain('knowledge:');
        expect(content).toContain('Berapa harga kaos?');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should handle answers without forbidden actions', async () => {
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const gen = new PromptGenerator({} as WAgentConfig);
        await gen.generateAll({
          ...defaultAnswers,
          forbiddenActions: [],
        });

        const content = readFileSync(join(TMP, 'prompts', 'system.toon'), 'utf-8');
        expect(content).toContain('Jangan membuat informasi palsu');
        expect(content).toContain('Jangan meminta data sensitif');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should handle answers without escalation triggers', async () => {
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const gen = new PromptGenerator({} as WAgentConfig);
        await gen.generateAll({
          ...defaultAnswers,
          escalationTriggers: [],
        });

        const content = readFileSync(join(TMP, 'prompts', 'system.toon'), 'utf-8');
        expect(content).not.toContain('Eskalasi ke manusia jika:');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should handle answers with appointment and inventory features', async () => {
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const gen = new PromptGenerator({} as WAgentConfig);
        await gen.generateAll({
          ...defaultAnswers,
          features: ['jadwal', 'inventori'],
        });

        const content = readFileSync(join(TMP, 'prompts', 'skills.toon'), 'utf-8');
        expect(content).toContain('appointment:');
        expect(content).toContain('inventory:');
        expect(content).not.toContain('shipping:');
        expect(content).not.toContain('payment:');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should use fallback messages when not provided', async () => {
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const gen = new PromptGenerator({} as WAgentConfig);
        await gen.generateAll({
          ...defaultAnswers,
          welcomeMessage: undefined,
          errorMessage: undefined,
          offlineMessage: undefined,
        });

        const content = readFileSync(join(TMP, 'prompts', 'messages.toon'), 'utf-8');
        expect(content).toContain('welcome:');
        expect(content).toContain('error_technical: Maaf, saya mengalami kendala teknis.');
        expect(content).toContain('offline: Mohon maaf, saat ini di luar jam operasional.');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should handle no greeting', async () => {
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const gen = new PromptGenerator({} as WAgentConfig);
        await gen.generateAll({
          ...defaultAnswers,
          greeting: undefined,
        });

        const system = readFileSync(join(TMP, 'prompts', 'system.toon'), 'utf-8');
        expect(system).not.toContain('Sapaan khusus');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should handle no frequent questions', async () => {
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const gen = new PromptGenerator({} as WAgentConfig);
        await gen.generateAll({
          ...defaultAnswers,
          frequentQuestions: [],
        });

        const content = readFileSync(join(TMP, 'prompts', 'skills.toon'), 'utf-8');
        expect(content).not.toContain('knowledge:');
      } finally {
        process.cwd = originalCwd;
      }
    });
  });

  describe('generateWithAI', () => {
    it('should fall back to generateAll (TODO)', async () => {
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const gen = new PromptGenerator({} as WAgentConfig);
        await gen.generateWithAI(defaultAnswers);
        expect(existsSync(join(TMP, 'prompts', 'system.toon'))).toBe(true);
      } finally {
        process.cwd = originalCwd;
      }
    });
  });
});
