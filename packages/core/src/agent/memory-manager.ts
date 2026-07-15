import { Logger } from 'pino';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { MemoryEntry, ContactProfile, AIMessage } from '../types.js';
import { getLogger } from '../utils/logger.js';
import { Summarizer } from './summarizer.js';

/**
 * MemoryManager handles short-term (JSONL) and long-term (Markdown)
 * memory storage for the v2 agent system.
 *
 * Directory structure:
 * ```
 * memory/
 * ├── contacts/
 * │   ├── {contactId}.md     → ContactProfile (Markdown)
 * │   └── ...
 * ├── conversations/
 * │   ├── {contactId}/
 * │   │   ├── {date}.jsonl   → MemoryEntry[] (JSONL, daily)
 * │   │   └── summary.md     → Auto-generated conversation summary
 * │   └── ...
 * └── _global/
 *     ├── facts.md           → User facts
 *     └── patterns.md        → Learned communication patterns
 * ```
 */
export class MemoryManager {
  private logger: Logger;
  private memoryDir: string;

  constructor(memoryDir?: string) {
    this.logger = getLogger().child({ module: 'memory-manager' });
    this.memoryDir = memoryDir || join(process.cwd(), 'memory');
    this.ensureDir('');
    this.ensureDir('contacts');
    this.ensureDir('conversations');
    this.ensureDir('_global');
  }

  getMemoryDir(): string {
    return this.memoryDir;
  }

  // ── Directory Management ──────────────────────────────────────

  private ensureDir(subPath: string): void {
    const dir = join(this.memoryDir, subPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private contactDir(contactId: string): string {
    const dir = join(this.memoryDir, 'contacts');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private conversationDir(contactId: string): string {
    const safe = contactId.replace(/[@.:\/]/g, '_');
    const dir = join(this.memoryDir, 'conversations', safe);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  // ── Contact Profile (Markdown) ─────────────────────────────────

  /**
   * Load a contact's profile from Markdown file.
   * Returns null if profile doesn't exist yet.
   */
  loadContactProfile(contactId: string): ContactProfile | null {
    try {
      const dir = this.contactDir(contactId);
      const safe = contactId.replace(/[@.:\/]/g, '_');
      const filePath = join(dir, `${safe}.md`);

      if (!existsSync(filePath)) return null;

      const content = readFileSync(filePath, 'utf-8');
      return this.parseContactProfile(contactId, content);
    } catch (err: any) {
      this.logger.warn({ contactId, error: err.message }, 'Failed to load contact profile');
      return null;
    }
  }

  /**
   * Save or update a contact's profile to Markdown file.
   */
  saveContactProfile(profile: ContactProfile): void {
    try {
      const dir = this.contactDir(profile.contactId);
      const safe = profile.contactId.replace(/[@.:\/]/g, '_');
      const filePath = join(dir, `${safe}.md`);
      const markdown = this.contactProfileToMarkdown(profile);
      writeFileSync(filePath, markdown, 'utf-8');
      this.logger.debug({ contactId: profile.contactId }, 'Contact profile saved');
    } catch (err: any) {
      this.logger.error({ contactId: profile.contactId, error: err.message }, 'Failed to save contact profile');
    }
  }

  /**
   * List all contact profiles available.
   */
  listContactProfiles(): { contactId: string; name: string }[] {
    try {
      const dir = join(this.memoryDir, 'contacts');
      if (!existsSync(dir)) return [];
      const files = readdirSync(dir).filter(f => f.endsWith('.md'));
      const profiles: { contactId: string; name: string }[] = [];
      for (const file of files) {
        const content = readFileSync(join(dir, file), 'utf-8');
        const nameMatch = content.match(/^# (.+)$/m);
        const contactId = file.replace(/\.md$/, '').replace(/_/g, '@');
        profiles.push({
          contactId,
          name: nameMatch?.[1] || contactId,
        });
      }
      return profiles;
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'Failed to list contact profiles');
      return [];
    }
  }

  /**
   * Parse a Markdown contact profile string into a ContactProfile.
   */
  private parseContactProfile(contactId: string, markdown: string): ContactProfile {
    const profile: ContactProfile = {
      contactId,
      name: '',
      tone: 'casual',
      updatedAt: new Date(),
    };

    // Parse name from heading
    const nameMatch = markdown.match(/^# (.+)$/m);
    if (nameMatch) profile.name = nameMatch[1].trim();

    // Parse stored Last updated timestamp
    const updatedMatch = markdown.match(/^Last updated: (.+)$/m);
    if (updatedMatch) {
      const parsed = new Date(updatedMatch[1]);
      if (!isNaN(parsed.getTime())) profile.updatedAt = parsed;
    }

    // Parse fields from list items (supports multi-word field names like "Contoh respon")
    const fields: Record<string, string> = {};
    const fieldRegex = /^- ([\w ]+): (.+)$/gm;
    let match;
    while ((match = fieldRegex.exec(markdown)) !== null) {
      fields[match[1].trim().toLowerCase()] = match[2].trim();
    }

    if (fields.relasi) profile.relationship = fields.relasi;
    if (fields.tone) {
      const validTones = ['casual', 'formal', 'professional', 'friendly', 'mixed'];
      profile.tone = validTones.includes(fields.tone) ? fields.tone as ContactProfile['tone'] : 'mixed';
    }
    if (fields.bahasa) profile.language = fields.bahasa;
    if (fields.sapaan) profile.greetings = fields.sapaan.split(',').map(s => s.trim().replace(/"/g, ''));
    if (fields.emoji) profile.emojiUsage = fields.emoji as ContactProfile['emojiUsage'];
    if (fields['contoh respon']) {
      // Strip surrounding quotes if present
      const val = fields['contoh respon'].replace(/^"(.+)"$/, '$1');
      profile.exampleResponses = [val];
    }
    if (fields.topik) profile.topics = fields.topik.split(',').map(s => s.trim());
    if (fields.catatan) profile.notes = fields.catatan;

    // Parse sections
    const sectionRegex = /^## (.+)$/gm;
    let sectionMatch;
    const sections: Record<string, string> = {};
    let lastSection = '';
    const lines = markdown.split('\n');
    for (const line of lines) {
      const secMatch = line.match(/^## (.+)$/);
      if (secMatch) {
        lastSection = secMatch[1].toLowerCase();
        sections[lastSection] = '';
      } else if (lastSection && line.trim()) {
        sections[lastSection] = (sections[lastSection] || '') + line.trim() + '\n';
      }
    }

    // Extra example responses from section
    if (sections['contoh respon']) {
      const examples = sections['contoh respon'].split('\n').filter(l => l.trim().startsWith('-'));
      if (examples.length > 0) {
        profile.exampleResponses = examples.map(e => e.replace(/^-\s*/, '').trim());
      }
    }

    // Parse ## Interaksi Terbaru section (PLAN.md format)
    if (sections['interaksi terbaru']) {
      const interactions = sections['interaksi terbaru'].split('\n')
        .filter(l => l.trim().startsWith('-'))
        .map(l => l.replace(/^-\s*/, '').trim());
      if (interactions.length > 0) {
        profile.recentInteractions = interactions;
      }
    }

    // Parse ## Pola yang Dipelajari section (PLAN.md format)
    if (sections['pola yang dipelajari']) {
      const patterns = sections['pola yang dipelajari'].split('\n')
        .filter(l => l.trim().startsWith('-'))
        .map(l => l.replace(/^-\s*/, '').trim());
      if (patterns.length > 0) {
        profile.learnedPatterns = patterns;
      }
    }

    return profile;
  }

  /**
   * Convert a ContactProfile to Markdown string.
   * Format mengikuti PLAN.md untuk konsistensi dokumentasi.
   *
   * ```markdown
   * # Budi Santoso
   * - Relasi: Teman kuliah
   * - Tone: Casual, sering pakai bahasa santai
   * - Bahasa: Indonesia campur Inggris
   * - Sapaan: "Bro", "Brod"
   * - Emoji: Jarang
   * - Contoh respon: "Oke bro gas aja"
   * - Topik: Gaming, Kerjaan
   *
   * ## Interaksi Terbaru
   * - 2026-07-13: Tanya kabar, ajak nongkrong
   *
   * ## Pola yang Dipelajari
   * - Suka kirim pesan pendek
   * ```
   */
  private contactProfileToMarkdown(profile: ContactProfile): string {
    const lines: string[] = [];
    lines.push(`# ${profile.name}`);
    lines.push('');

    if (profile.relationship) lines.push(`- Relasi: ${profile.relationship}`);

    // Tone value (enum, untuk parsing round-trip)
    lines.push(`- Tone: ${profile.tone}`);
    // Deskripsi tone terpisah (human-readable, sesuai PLAN.md)
    const toneDescriptions: Record<string, string> = {
      casual: 'Casual, sering pakai bahasa santai',
      formal: 'Formal, menggunakan bahasa baku',
      professional: 'Professional, sopan dan terstruktur',
      friendly: 'Ramah, hangat, dan akrab',
      mixed: 'Campuran, menyesuaikan konteks',
    };
    if (toneDescriptions[profile.tone]) {
      lines.push(`- Deskripsi Tone: ${toneDescriptions[profile.tone]}`);
    }

    if (profile.language) lines.push(`- Bahasa: ${profile.language}`);
    if (profile.greetings && profile.greetings.length > 0) {
      lines.push(`- Sapaan: ${profile.greetings.map(g => `"${g}"`).join(', ')}`);
    }
    if (profile.emojiUsage) {
      // Emoji value (enum, untuk parsing round-trip)
      lines.push(`- Emoji: ${profile.emojiUsage}`);
      // Deskripsi terpisah (human-readable)
      const emojiDescriptions: Record<string, string> = {
        rare: 'Jarang',
        moderate: 'Kadang-kadang',
        frequent: 'Sering',
      };
      if (emojiDescriptions[profile.emojiUsage]) {
        lines.push(`- Penggunaan Emoji: ${emojiDescriptions[profile.emojiUsage]}`);
      }
    }
    if (profile.exampleResponses && profile.exampleResponses.length > 0) {
      lines.push(`- Contoh respon: "${profile.exampleResponses[0]}"`);
    }
    if (profile.topics && profile.topics.length > 0) {
      lines.push(`- Topik: ${profile.topics.join(', ')}`);
    }
    if (profile.notes) lines.push(`- Catatan: ${profile.notes}`);

    lines.push('');
    lines.push(`Last updated: ${profile.updatedAt.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`);

    // ## Interaksi Terbaru (PLAN.md section)
    if (profile.recentInteractions && profile.recentInteractions.length > 0) {
      lines.push('');
      lines.push('## Interaksi Terbaru');
      for (const interaction of profile.recentInteractions.slice(-5)) {
        lines.push(`- ${interaction}`);
      }
    }

    // ## Pola yang Dipelajari (PLAN.md section)
    if (profile.learnedPatterns && profile.learnedPatterns.length > 0) {
      lines.push('');
      lines.push('## Pola yang Dipelajari');
      for (const pattern of profile.learnedPatterns.slice(-5)) {
        lines.push(`- ${pattern}`);
      }
    }

    if (profile.exampleResponses && profile.exampleResponses.length > 1) {
      lines.push('');
      lines.push('## Contoh Respon');
      for (const example of profile.exampleResponses) {
        lines.push(`- ${example}`);
      }
    }

    return lines.join('\n');
  }

  // ── Short-term Memory (JSONL) ─────────────────────────────────

  /**
   * Append a memory entry to today's JSONL file for a contact.
   */
  appendMemory(contactId: string, role: MemoryEntry['role'], content: string, metadata?: Record<string, unknown>): void {
    try {
      const dir = this.conversationDir(contactId);
      const today = new Date().toISOString().split('T')[0];
      const filePath = join(dir, `${today}.jsonl`);

      const entry: MemoryEntry = {
        contactId,
        role,
        content,
        timestamp: new Date().toISOString(),
        metadata,
      };

      appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err: any) {
      this.logger.warn({ contactId, error: err.message }, 'Failed to append memory');
    }
  }

  /**
   * Read recent memory entries for a contact.
   * Can read from multiple days if needed.
   */
  readRecentMemory(contactId: string, maxEntries = 50): MemoryEntry[] {
    try {
      const dir = this.conversationDir(contactId);
      if (!existsSync(dir)) return [];

      const files = readdirSync(dir)
        .filter(f => f.endsWith('.jsonl'))
        .sort()
        .reverse();

      const entries: MemoryEntry[] = [];

      for (const file of files) {
        if (entries.length >= maxEntries) break;
        const filePath = join(dir, file);
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);

        for (const line of lines.reverse()) {
          if (entries.length >= maxEntries) break;
          try {
            const entry = JSON.parse(line) as MemoryEntry;
            entries.unshift(entry);
          } catch { /* skip malformed lines */ }
        }
      }

      return entries;
    } catch (err: any) {
      this.logger.warn({ contactId, error: err.message }, 'Failed to read memory');
      return [];
    }
  }

  /**
   * Get memory entries as AIMessage array for LLM context.
   */
  getMemoryAsMessages(contactId: string, maxEntries = 30): AIMessage[] {
    const entries = this.readRecentMemory(contactId, maxEntries);
    return entries
      .filter(e => e.role !== 'system') // system role from memory is handled separately
      .map(e => ({
        role: e.role as AIMessage['role'],
        content: e.content,
      }));
  }

  // ── Long-term Memory (Markdown files) ─────────────────────────

  /**
   * Append a fact to the global facts file.
   */
  addFact(fact: string): void {
    try {
      const filePath = join(this.memoryDir, '_global', 'facts.md');
      const date = new Date().toISOString().split('T')[0];
      const entry = `- [${date}] ${fact}\n`;
      appendFileSync(filePath, entry, 'utf-8');
      this.logger.debug({ fact }, 'Fact added');
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'Failed to add fact');
    }
  }

  /**
   * Read all facts from global facts file.
   */
  getFacts(): string {
    try {
      const filePath = join(this.memoryDir, '_global', 'facts.md');
      if (!existsSync(filePath)) return '';
      return readFileSync(filePath, 'utf-8');
    } catch {
      return '';
    }
  }

  /**
   * Append a learned pattern to the patterns file.
   */
  addPattern(pattern: string): void {
    try {
      const filePath = join(this.memoryDir, '_global', 'patterns.md');
      const date = new Date().toISOString().split('T')[0];
      const entry = `- [${date}] ${pattern}\n`;
      appendFileSync(filePath, entry, 'utf-8');
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'Failed to add pattern');
    }
  }

  /**
   * Read all learned patterns.
   */
  getPatterns(): string {
    try {
      const filePath = join(this.memoryDir, '_global', 'patterns.md');
      if (!existsSync(filePath)) return '';
      return readFileSync(filePath, 'utf-8');
    } catch {
      return '';
    }
  }

  // ── Conversation Summary ──────────────────────────────────────

  /**
   * Save a summary of a conversation for long-term context.
   */
  saveConversationSummary(contactId: string, summary: string): void {
    try {
      const dir = this.conversationDir(contactId);
      const filePath = join(dir, 'summary.md');
      writeFileSync(filePath, summary, 'utf-8');
    } catch (err: any) {
      this.logger.warn({ contactId, error: err.message }, 'Failed to save conversation summary');
    }
  }

  /**
   * Load conversation summary if it exists.
   */
  loadConversationSummary(contactId: string): string | null {
    try {
      const dir = this.conversationDir(contactId);
      const filePath = join(dir, 'summary.md');
      if (!existsSync(filePath)) return null;
      return readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  // ── Auto-Summarization ──────────────────────────────────────────

  /**
   * Count recent conversation entries (JSONL lines) for a contact.
   */
  countMemoryEntries(contactId: string): number {
    try {
      const dir = this.conversationDir(contactId);
      if (!existsSync(dir)) return 0;

      const files = readdirSync(dir)
        .filter(f => f.endsWith('.jsonl'))
        .sort()
        .reverse();

      let count = 0;
      for (const file of files) {
        if (count >= 50) break;
        const content = readFileSync(join(dir, file), 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);
        count += Math.min(lines.length, 50 - count);
      }
      return count;
    } catch {
      return 0;
    }
  }

  /**
   * Check if a conversation has enough entries to warrant summarization.
   * Uses the Summarizer's threshold.
   */
  needsSummarization(contactId: string, minEntries = 20): boolean {
    const count = this.countMemoryEntries(contactId);
    return count >= minEntries;
  }

  /**
   * Generate and save a conversation summary for a contact.
   * Uses the provided Summarizer instance for abstractive/extractive generation.
   * Returns the generated summary, or null if failed.
   */
  async generateAndSaveSummary(contactId: string, summarizer: Summarizer): Promise<string | null> {
    try {
      const entries = this.readRecentMemory(contactId, 50);
      if (entries.length === 0) {
        this.logger.debug({ contactId }, 'No entries to summarize');
        return null;
      }

      const summary = await summarizer.summarize(entries);
      if (!summary) {
        this.logger.debug({ contactId }, 'Empty summary generated');
        return null;
      }

      this.saveConversationSummary(contactId, summary);
      this.logger.info({ contactId, entryCount: entries.length }, 'Conversation summary saved');
      return summary;
    } catch (err: any) {
      this.logger.error({ contactId, error: err.message }, 'Failed to generate conversation summary');
      return null;
    }
  }

  /**
   * Delete old JSONL files after their content has been summarized.
   * Keeps only the summary.md and the most recent day's raw data.
   * Returns number of deleted files.
   */
  compactMemoryAfterSummary(contactId: string): number {
    try {
      const dir = this.conversationDir(contactId);
      if (!existsSync(dir)) return 0;

      const files = readdirSync(dir)
        .filter(f => f.endsWith('.jsonl'))
        .sort(); // Oldest first

      // Keep the most recent file (today's or yesterday's)
      const filesToDelete = files.slice(0, Math.max(0, files.length - 1));

      let deleted = 0;
      for (const file of filesToDelete) {
        try {
          unlinkSync(join(dir, file));
          deleted++;
        } catch { /* ignore */ }
      }

      if (deleted > 0) {
        this.logger.info({ contactId, deleted }, 'Compacted memory — deleted old JSONL files');
      }

      return deleted;
    } catch (err: any) {
      this.logger.warn({ contactId, error: err.message }, 'Failed to compact memory');
      return 0;
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────

  /**
   * Clean up old memory files (older than specified days).
   * Returns number of files cleaned.
   */
  cleanupOldMemory(daysOld = 30): number {
    try {
      const dir = join(this.memoryDir, 'conversations');
      if (!existsSync(dir)) return 0;
      const now = Date.now();
      const cutoff = now - daysOld * 24 * 60 * 60 * 1000;
      let cleaned = 0;

      const contacts = readdirSync(dir);
      for (const contact of contacts) {
        const contactPath = join(dir, contact);
        const files = readdirSync(contactPath).filter(f => f.endsWith('.jsonl'));
        for (const file of files) {
          const filePath = join(contactPath, file);
          // Simple check: parse date from filename YYYY-MM-DD.jsonl
          const dateStr = file.replace('.jsonl', '');
          const fileDate = new Date(dateStr).getTime();
          if (!isNaN(fileDate) && fileDate < cutoff) {
            try {
              unlinkSync(filePath);
              cleaned++;
            } catch { /* ignore */ }
          }
        }
      }
      return cleaned;
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'Failed to cleanup old memory');
      return 0;
    }
  }
}
