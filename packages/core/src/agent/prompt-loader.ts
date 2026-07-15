import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { decode } from '@toon-format/toon';
import { getLogger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * PromptLoader loads and parses TOON prompt files.
 * Used for personality, summarizer, and skill prompts.
 */
export class PromptLoader {
  private static instance: PromptLoader;
  private cache: Map<string, any> = new Map();
  private promptsDir: string;

  private constructor() {
    // Find prompts directory - prefer root prompts/ (has all TOON files)
    // Saat global install, core bisa nested di dalam @wagent/wagent/node_modules/@wagent/core/dist/agent/
    const possiblePaths = [
      join(__dirname, '../../../../prompts'),          // dev: packages/core/src/agent -> root/prompts
      join(__dirname, '../../../prompts'),             // dev: packages/core/src -> root/prompts
      join(__dirname, '../../prompts'),                // dev: packages/core -> root/prompts (alt)
      join(__dirname, '../../../../../prompts'),       // npm global: @wagent/core/dist/agent -> @wagent/wagent/prompts
      join(__dirname, '../../../../../../prompts'),    // npm global nested: node_modules/@wagent/wagent/node_modules/@wagent/core/dist/agent
      join(process.cwd(), 'prompts'),                  // cwd fallback
      join(__dirname, '../prompts'),                   // packages/core/prompts (legacy)
    ];
    
    this.promptsDir = possiblePaths.find(p => existsSync(p)) || possiblePaths[0];
  }

  static getInstance(): PromptLoader {
    if (!PromptLoader.instance) {
      PromptLoader.instance = new PromptLoader();
    }
    return PromptLoader.instance;
  }

  getPromptsDir(): string {
    return this.promptsDir;
  }

  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Load and parse a TOON file
   */
  load(filename: string): any {
    if (this.cache.has(filename)) {
      return this.cache.get(filename);
    }

    const filePath = join(this.promptsDir, filename);
    
    if (!existsSync(filePath)) {
      getLogger().warn(`Prompt file not found: ${filePath}`);
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8').trim();
      const parsed = decode(content);
      this.cache.set(filename, parsed);
      getLogger().debug(`Loaded prompt file: ${filePath}`);
      return parsed;
    } catch (error) {
      getLogger().error(`Failed to parse ${filename}: ${error}`);
      return null;
    }
  }

  /**
   * Get tone instructions from personality.toon
   */
  getToneInstructions(): Record<string, string> {
    const personality = this.load('personality.toon');
    if (!personality?.tones) {
      return {
        casual: 'Gunakan bahasa yang santai dan natural.',
        formal: 'Gunakan bahasa yang formal dan sopan.',
        professional: 'Gunakan bahasa profesional namun tetap ramah.',
        friendly: 'Gunakan bahasa yang ramah dan hangat.',
        mixed: 'Sesuaikan gaya dengan konteks percakapan.',
      };
    }

    const result: Record<string, string> = {};
    for (const [tone, data] of Object.entries(personality.tones) as any) {
      result[tone] = data.instruction;
    }
    return result;
  }

  /**
   * Get emoji instructions from personality.toon
   */
  getEmojiInstructions(): Record<string, string> {
    const personality = this.load('personality.toon');
    if (!personality?.emoji) {
      return {
        rare: 'Hindari emoji.',
        moderate: 'Gunakan emoji sesekali.',
        frequent: 'Boleh sering menggunakan emoji.',
      };
    }
    return personality.emoji;
  }

  /**
   * Get context directives from personality.toon
   */
  getContextDirectives(): Record<string, string> {
    const personality = this.load('personality.toon');
    if (!personality?.context) {
      return {
        urgent: 'Konteks: URGEN. Respons harus langsung dan efisien.',
        business: 'Konteks: BISNIS. Gunakan bahasa profesional.',
        default: 'Gunakan gaya yang ramah dan profesional.',
        urgent_default: 'Konteks URGEN. Respons langsung dan efisien.',
        business_default: 'Konteks BISNIS. Gunakan bahasa profesional.',
      };
    }
    return personality.context;
  }

  /**
   * Get summarizer instructions from summarizer.toon
   */
  getSummarizerPrompt(): string {
    const summarizer = this.load('summarizer.toon');
    if (!summarizer) {
      return `You are a conversation summarizer. Generate a concise summary in Bahasa Indonesia.
Format your summary as Markdown with these sections:
- **Topik Utama:** What topics were discussed
- **Keputusan:** Any decisions made
- **Action Items:** Any follow-ups or action items
- **Sentimen:** Overall tone/mood
- **Key Facts:** Important information shared`;
    }

    // Convert TOON to prompt - extract sections and instructions
    const sections: string[] = [];
    const instructions: string[] = [];
    
    for (const [key, value] of Object.entries(summarizer) as any) {
      if (key.startsWith('section_')) {
        sections.push(value);
      } else if (key.startsWith('instruction_')) {
        instructions.push(value);
      }
    }
    
    let prompt = `You are a ${summarizer.role || 'conversation summarizer'}. Generate a concise summary in Bahasa Indonesia.\n\n`;
    prompt += 'Format your summary as Markdown with these sections:\n';
    
    for (const section of sections) {
      const [name, desc] = section.split(' - ');
      prompt += `- **${name}:** ${desc}\n`;
    }
    
    if (instructions.length > 0) {
      prompt += '\nInstructions:\n';
      for (const inst of instructions) {
        prompt += `- ${inst}\n`;
      }
    }
    
    return prompt;
  }

  /**
   * Get provider-specific summarizer instruction
   */
  getSummarizerProviderInstruction(provider: string): string {
    const summarizer = this.load('summarizer.toon');
    if (!summarizer?.[`provider_${provider}`]) {
      return 'You are a helpful summarization assistant. Always respond in Bahasa Indonesia.';
    }
    return summarizer[`provider_${provider}`];
  }

  /**
   * Get skill prompt addition from skills.toon
   */
  getSkillPrompt(skillName: string): string | null {
    const skills = this.load('skills.toon');
    if (!skills?.[skillName]?.prompt) {
      return null;
    }
    return skills[skillName].prompt;
  }

  /**
   * Get all skill prompt additions
   */
  getAllSkillPrompts(): Record<string, string> {
    const skills = this.load('skills.toon');
    if (!skills) {
      return {};
    }

    const result: Record<string, string> = {};
    for (const [name, data] of Object.entries(skills) as any) {
      if (data.prompt) {
        result[name] = data.prompt;
      }
    }
    return result;
  }

  // ── Messages (welcome, rate limit, offline) ─────────────────────

  getWelcomeMessage(): string {
    const messages = this.load('messages.toon');
    return messages?.welcome || 'Halo! Ada yang bisa saya bantu hari ini?';
  }

  getRateLimitMessage(): string {
    const messages = this.load('messages.toon');
    return messages?.rate_limit || 'Mohon tunggu sebentar ya.';
  }

  getOfflineMessage(): string {
    const messages = this.load('messages.toon');
    return messages?.offline || 'Di luar jam operasional.';
  }

  getErrorMessage(): string {
    const messages = this.load('messages.toon');
    return messages?.error_technical || 'Maaf, saya mengalami kendala teknis. Silakan coba lagi nanti.';
  }

  // ── Context Builder ─────────────────────────────────────────────

  getContextBuilderConfig(): Record<string, string> {
    const cb = this.load('context-builder.toon');
    return cb || {
      section_relationship: 'Hubungan dengan Kontak Ini',
      section_style: 'Gaya Komunikasi',
      section_contact: 'Informasi Kontak',
      section_new_conversation: 'Konteks',
      section_summary: 'Ringkasan Percakapan Sebelumnya',
      section_additions: 'Panduan Tambahan',
      label_relationship: 'Hubungan',
      label_contact: 'Kontak saat ini',
      label_new_conversation: 'Ini adalah awal percakapan dengan kontak ini. Sambut dengan hangat.',
      style_language: 'Bahasa',
      style_greetings: 'Sapaan yang biasa digunakan',
      style_topics: 'Topik yang sering dibahas',
      style_examples: 'Contoh gaya respon',
    };
  }

  // ── Transcriber ─────────────────────────────────────────────────

  /**
   * Get transcriber instruction
   */
  getTranscriberInstruction(): string {
    const transcriber = this.load('transcriber.toon');
    return transcriber?.instruction || 'Transkripsikan pesan suara ini ke teks. Hanya balas dengan teks hasil transkripsi.';
  }

  // ── Escalation ──────────────────────────────────────────────────

  getEscalationConfig(): Record<string, string> {
    const esc = this.load('escalation.toon');
    return esc || {
      title: 'ESCALATION - AI butuh bantuan manusia',
      label_customer: 'Pelanggan',
      label_phone: 'Nomor',
      label_reason: 'Alasan',
      label_detail: 'Detail',
      label_message: 'Pesan customer',
      label_history: 'Riwayat percakapan',
      action_instruction: 'Balas customer ini melalui WhatsApp Web. AI akan berhenti otomatis.',
      reason_ai_error: 'Error AI provider',
      reason_ai_empty: 'AI tidak bisa memberikan jawaban',
      reason_ai_escalation: 'AI meminta bantuan manusia',
      reason_tool_failure: 'Gagal menjalankan tool',
      escalation_pending: 'Tindakan membutuhkan persetujuan. Menunggu persetujuan...',
      escalation_approved: 'Persetujuan diberikan.',
      escalation_rejected: 'Persetujuan ditolak.',
    };
  }

  // ── Telegram Bot ────────────────────────────────────────────────

  getTelegramConfig(): Record<string, string> {
    const tg = this.load('telegram.toon');
    return tg || {
      status_paused: 'Agent is already paused. Use /resume to resume.',
      status_paused_done: 'Agent PAUSED. AI will not auto-reply to messages. Use /resume to enable again.',
      status_active: 'Agent is already active. Use /pause to pause.',
      status_active_done: 'Agent RESUMED. AI will now auto-reply to messages.',
      approve_usage: 'Usage: /approve <request_id> [note]',
      approve_not_found: 'Could not approve. Request not found or already resolved.',
      approve_done: 'Approved',
      reject_usage: 'Usage: /reject <request_id> [reason]',
      reject_not_found: 'Could not reject. Request not found or already resolved.',
      reject_done: 'Rejected',
      pending_empty: 'No pending approval requests.',
      pending_header: 'Pending Approvals',
      contacts_empty: 'No contacts yet.',
      contacts_header: 'Contacts',
      logs_empty: 'No recent activity.',
      logs_header: 'Recent Activity',
      help_header: 'WAGENT Bot Commands',
      help_status: 'Status and Control',
      help_approval: 'Approval',
      help_information: 'Information',
      unknown_command: 'Unknown command',
      add_contact_usage: 'Usage: /add_contact <name> <relationship>',
      add_contact_example: 'Example: /add_contact Budi Santoso Teman kuliah',
    };
  }

  // ── Self-Chat ───────────────────────────────────────────────────

  getSelfChatConfig(): Record<string, string> {
    const sc = this.load('self-chat.toon');
    return sc || {
      help_hint: 'Kirim /help untuk daftar command',
      pause_done: 'Agent di-pause. Kirim /resume untuk melanjutkan.',
      resume_done: 'Agent di-resume. Siap melayani customer.',
      contacts_empty: 'Belum ada kontak.',
      contacts_header: 'Kontak Terakhir',
      command_unknown: 'Command tidak dikenal',
      command_error: 'Error',
      help_header: 'WAGENT Self-Chat Commands',
      help_status: 'Lihat status agent',
      help_pause: 'Pause auto-reply',
      help_resume: 'Resume auto-reply',
      help_stats: 'Statistik hari ini',
      help_contacts: 'Daftar kontak',
      help_help: 'Tampilkan bantuan ini',
      status_header: 'WAGENT Status',
    };
  }
}

// Export singleton
export const promptLoader = PromptLoader.getInstance();