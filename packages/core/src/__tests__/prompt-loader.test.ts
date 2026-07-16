import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PromptLoader } from '../agent/prompt-loader.js';

import { writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('PromptLoader', () => {
  let loader: PromptLoader;
  const TMP_DIR = join(__dirname, 'tmp-prompts-test');
  let originalPromptsDir: string;

  beforeAll(() => {
    loader = PromptLoader.getInstance();
    const searchPaths = [
      join(process.cwd(), 'packages/core/prompts'),
      join(process.cwd(), 'prompts'),
      join(__dirname, '../../prompts'),
      join(__dirname, '../../../prompts'),
    ];
    originalPromptsDir = searchPaths.find(p => existsSync(join(p, 'summarizer.toon'))) || loader.getPromptsDir();

    if (!existsSync(TMP_DIR)) {
      mkdirSync(TMP_DIR, { recursive: true });
    }

    if (existsSync(originalPromptsDir)) {
      const files = readdirSync(originalPromptsDir);
      for (const file of files) {
        if (file.endsWith('.toon')) {
          copyFileSync(join(originalPromptsDir, file), join(TMP_DIR, file));
        }
      }
    }

    writeFileSync(join(TMP_DIR, 'personality.toon'), `
tones:
  casual:
    description: santai
    instruction: santai
  formal:
    description: formal
    instruction: formal
  professional:
    description: profesional
    instruction: profesional
  friendly:
    description: ramah
    instruction: ramah
  mixed:
    description: mixed
    instruction: Sesuaikan
emoji:
  rare: rare
  moderate: moderate
  frequent: frequent
context:
  urgent: URGEN
  business: business
  default: default
    `, 'utf-8');

    writeFileSync(join(TMP_DIR, 'skills.toon'), `
shipping:
  prompt: ongkos kirim
payment:
  prompt: pembayaran
weather:
  prompt: cuaca
pos-connector:
  prompt: POS
    `, 'utf-8');

    writeFileSync(join(TMP_DIR, 'messages.toon'), `
welcome: Halo!
rate_limit: tunggu
offline: operasional
error_technical: kendala teknis
    `, 'utf-8');
  });

  afterAll(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    loader = PromptLoader.getInstance();
    loader['promptsDir'] = TMP_DIR;
    loader.clearCache();
  });

  describe('singleton', () => {
    it('should return the same instance', () => {
      const a = PromptLoader.getInstance();
      const b = PromptLoader.getInstance();
      expect(a).toBe(b);
    });
  });

  describe('load', () => {
    it('should load personality.toon', () => {
      const result = loader.load('personality.toon');
      expect(result).toBeDefined();
      expect(result.tones).toBeDefined();
      expect(result.tones.casual.instruction).toContain('santai');
    });

    it('should return null for missing file', () => {
      const result = loader.load('nonexistent-file-xyz.toon');
      expect(result).toBeNull();
    });

    it('should cache loaded files', () => {
      const a = loader.load('personality.toon');
      const b = loader.load('personality.toon');
      expect(a).toBe(b);
    });
  });

  describe('getToneInstructions', () => {
    it('should return all tone instructions', () => {
      const tones = loader.getToneInstructions();
      expect(tones.casual).toContain('santai');
      expect(tones.formal).toContain('formal');
      expect(tones.professional).toContain('profesional');
      expect(tones.friendly).toContain('ramah');
      expect(tones.mixed).toContain('Sesuaikan');
    });
  });

  describe('getEmojiInstructions', () => {
    it('should return emoji instructions', () => {
      const emoji = loader.getEmojiInstructions();
      expect(emoji.rare).toBeDefined();
      expect(emoji.moderate).toBeDefined();
      expect(emoji.frequent).toBeDefined();
    });
  });

  describe('getContextDirectives', () => {
    it('should return context directives', () => {
      const ctx = loader.getContextDirectives();
      expect(ctx.urgent).toContain('URGEN');
      expect(ctx.default).toBeDefined();
    });
  });

  describe('getSummarizerPrompt', () => {
    it('should build a prompt with sections', () => {
      const prompt = loader.getSummarizerPrompt();
      expect(prompt).toContain('conversation-summarizer');
      expect(prompt).toContain('Topik Utama');
      expect(prompt).toContain('Keputusan');
      expect(prompt).toContain('Action Items');
      expect(prompt).toContain('Sentimen');
      expect(prompt).toContain('Key Facts');
      expect(prompt).toContain('Bahasa Indonesia');
    });
  });

  describe('getSummarizerProviderInstruction', () => {
    it('should return openai instruction', () => {
      const inst = loader.getSummarizerProviderInstruction('openai');
      expect(inst).toContain('helpful summarization assistant');
    });

    it('should return gemini instruction', () => {
      const inst = loader.getSummarizerProviderInstruction('gemini');
      expect(inst).toContain('helpful summarization assistant');
    });

    it('should return default for unknown provider', () => {
      const inst = loader.getSummarizerProviderInstruction('unknown');
      expect(inst).toContain('helpful summarization assistant');
    });
  });

  describe('getSkillPrompt', () => {
    it('should return prompt for shipping skill', () => {
      const prompt = loader.getSkillPrompt('shipping');
      expect(prompt).toContain('ongkos kirim');
    });

    it('should return prompt for payment skill', () => {
      const prompt = loader.getSkillPrompt('payment');
      expect(prompt).toContain('pembayaran');
    });

    it('should return null for unknown skill', () => {
      const prompt = loader.getSkillPrompt('nonexistent-skill');
      expect(prompt).toBeNull();
    });
  });

  describe('getAllSkillPrompts', () => {
    it('should return all skill prompts', () => {
      const prompts = loader.getAllSkillPrompts();
      expect(prompts.shipping).toContain('ongkos kirim');
      expect(prompts.payment).toContain('pembayaran');
      expect(prompts.weather).toContain('cuaca');
      expect(prompts['pos-connector']).toContain('POS');
    });
  });

  describe('messages', () => {
    it('getWelcomeMessage', () => {
      const msg = loader.getWelcomeMessage();
      expect(msg).toContain('Halo');
    });

    it('getRateLimitMessage', () => {
      const msg = loader.getRateLimitMessage();
      expect(msg).toContain('tunggu');
    });

    it('getOfflineMessage', () => {
      const msg = loader.getOfflineMessage();
      expect(msg).toContain('operasional');
    });

    it('getErrorMessage', () => {
      const msg = loader.getErrorMessage();
      expect(msg).toContain('kendala teknis');
    });
  });

  describe('getContextBuilderConfig', () => {
    it('should return all config keys', () => {
      const cfg = loader.getContextBuilderConfig();
      expect(cfg.section_relationship).toContain('Hubungan');
      expect(cfg.section_style).toContain('Gaya');
      expect(cfg.section_contact).toContain('Informasi');
      expect(cfg.section_summary).toContain('Ringkasan');
      expect(cfg.style_language).toContain('Bahasa');
    });
  });

  describe('getTranscriberInstruction', () => {
    it('should return transcriber instruction', () => {
      const inst = loader.getTranscriberInstruction();
      expect(inst).toContain('Transkripsikan');
      expect(inst).toContain('teks');
    });
  });

  describe('getEscalationConfig', () => {
    it('should return all escalation keys', () => {
      const cfg = loader.getEscalationConfig();
      expect(cfg.title).toContain('ESCALATION');
      expect(cfg.label_customer).toContain('Pelanggan');
      expect(cfg.label_phone).toContain('Nomor');
      expect(cfg.label_reason).toContain('Alasan');
      expect(cfg.reason_ai_error).toContain('Error');
      expect(cfg.escalation_pending).toContain('persetujuan');
    });
  });

  describe('getTelegramConfig', () => {
    it('should return all telegram config keys', () => {
      const cfg = loader.getTelegramConfig();
      expect(cfg.status_paused).toContain('paused');
      expect(cfg.status_active).toContain('active');
      expect(cfg.approve_done).toContain('Approved');
      expect(cfg.reject_done).toContain('Rejected');
      expect(cfg.unknown_command).toContain('Unknown');
      expect(cfg.help_header).toContain('Commands');
    });
  });

  describe('getSelfChatConfig', () => {
    it('should return all self-chat config keys', () => {
      const cfg = loader.getSelfChatConfig();
      expect(cfg.help_hint).toContain('/help');
      expect(cfg.pause_done).toContain('pause');
      expect(cfg.resume_done).toContain('resume');
      expect(cfg.command_unknown).toContain('tidak dikenal');
      expect(cfg.status_header).toContain('Status');
    });
  });
});