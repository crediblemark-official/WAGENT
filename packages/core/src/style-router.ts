import { Logger } from 'pino';
import { ContactProfile, StyleDirective } from './types.js';
import { MemoryManager } from './memory-manager.js';
import { getLogger } from './logger.js';
import { TONE_DESCRIPTIONS, EMOJI_INSTRUCTIONS, VALID_TONES } from './style-descriptions.js';

/**
 * StyleRouter handles per-contact communication style.
 * It loads contact profiles from MemoryManager and produces
 * StyleDirectives that the ContextBuilder uses to shape
 * the AI's communication style.
 *
 * Learning sources:
 * 1. Manual setup via MemoryManager contact profiles
 * 2. Auto-learn from conversation analysis (Phase 4)
 * 3. Corrections from user feedback (Phase 4)
 */
export class StyleRouter {
  private logger: Logger;
  private memoryManager: MemoryManager;

  constructor(memoryManager: MemoryManager) {
    this.logger = getLogger().child({ module: 'style-router' });
    this.memoryManager = memoryManager;
  }

  /**
   * Get or create a default profile for a contact.
   * If no profile exists, creates a basic one.
   */
  async getOrCreateProfile(contactId: string, name: string): Promise<ContactProfile> {
    const existing = this.memoryManager.loadContactProfile(contactId);
    if (existing) return existing;

    // Create default profile
    const profile: ContactProfile = {
      contactId,
      name,
      tone: 'friendly',
      updatedAt: new Date(),
    };

    this.memoryManager.saveContactProfile(profile);
    return profile;
  }

  /**
   * Determine conversation context type from recent messages.
   * Digunakan oleh StyleRouter untuk menyesuaikan gaya komunikasi
   * berdasarkan konteks percakapan (casual / urgent / business).
   * Sesuai dokumentasi PLAN.md Step 4.
   */
  detectContextType(contactId: string): 'casual' | 'urgent' | 'business' | 'unknown' {
    try {
      const entries = this.memoryManager.readRecentMemory(contactId, 5);
      if (entries.length === 0) return 'unknown';

      const texts = entries.map(e => e.content.toLowerCase());
      const lastMessage = texts[texts.length - 1] || '';

      // Urgent indicators
      const urgentPatterns = [
        /\b(urgent|penting|darurat|segera|cepat|tolong\s+segera|mendesak)\b/i,
        /\b(error|rusak|error|masalah|ga[gal]\s+bisa|nggak\s+bisa|tidak\s+bisa)\b/i,
        /\b(komplain|keluhan|marah|kesal|kecewa|frustrasi)\b/i,
      ];

      // Business indicators
      const businessPatterns = [
        /\b(order|pesan|beli|checkout|purchase|harga|ongkir)\b/i,
        /\b(pembayaran|transfer|rekening|invoice|struk|kwitansi)\b/i,
        /\b(produk|barang|katalog|stok|tersedia)\b/i,
        /\b(jadwal|jam\s+buka|tutup|operasional|buka|tutup)\b/i,
      ];

      // Check urgent first
      for (const text of texts) {
        for (const p of urgentPatterns) {
          if (p.test(text)) return 'urgent';
        }
      }

      // Check business
      let businessScore = 0;
      for (const text of texts) {
        for (const p of businessPatterns) {
          if (p.test(text)) { businessScore++; break; }
        }
      }

      if (businessScore >= 2) return 'business';

      // Greeting/casual indicators
      const casualPatterns = [/\b(halo|hai|hey|gimana|kabar|main|nongkrong|makan|kopi)\b/i];
      for (const text of texts) {
        for (const p of casualPatterns) {
          if (p.test(text)) return 'casual';
        }
      }

      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Get style directive for a specific contact.
   * Returns default neutral style if no profile exists.
   * Menerapkan context-aware style sesuai PLAN.md:
   * - casual chat → gunakan tone biasa
   * - urgent → lebih langsung dan efisien
   * - business → lebih profesional
   */
  async getStyleDirective(contactId: string, name: string, contextType?: string): Promise<StyleDirective> {
    const profile = this.memoryManager.loadContactProfile(contactId);
    const validContextType = contextType as 'casual' | 'urgent' | 'business' | 'unknown' | undefined;

    if (!profile) {
      return this.getDefaultDirective(name, validContextType);
    }

    return this.profileToDirective(profile, validContextType);
  }

  /**
   * Convert a ContactProfile to a StyleDirective.
   * Optionally accepts contextType untuk context-aware style (PLAN.md Step 4).
   * - casual: gunakan tone biasa
   * - urgent: lebih langsung dan efisien
   * - business: lebih profesional
   */
  profileToDirective(profile: ContactProfile, contextType?: 'casual' | 'urgent' | 'business' | 'unknown'): StyleDirective {
    const parts: string[] = [];
    parts.push(`Gunakan gaya ${TONE_DESCRIPTIONS[profile.tone] || 'ramah'}.`);

    // Context-aware style adjustments (PLAN.md — Step 4)
    if (contextType === 'urgent') {
      parts.push('Konteks: URGEN. Respons harus langsung, efisien, dan to the point. Hindari basa-basi.');
    } else if (contextType === 'business') {
      parts.push('Konteks: BISNIS. Gunakan bahasa yang profesional, informatif, dan terstruktur.');
    }

    if (profile.language) {
      parts.push(`Bahasa: ${profile.language}.`);
    }

    if (profile.greetings && profile.greetings.length > 0) {
      parts.push(`Sapa dengan: ${profile.greetings.join(' atau ')}.`);
    }

    if (profile.emojiUsage && EMOJI_INSTRUCTIONS[profile.emojiUsage]) {
      parts.push(EMOJI_INSTRUCTIONS[profile.emojiUsage]);
    }

    return {
      tone: profile.tone,
      styleInstructions: parts.join(' '),
      examples: profile.exampleResponses || [],
    };
  }

  /**
   * Default style directive for unknown contacts.
   * Context-aware: urgent → efficient, business → professional.
   */
  private getDefaultDirective(name: string, contextType?: 'casual' | 'urgent' | 'business' | 'unknown'): StyleDirective {
    let styleInstructions = 'Gunakan gaya yang ramah dan profesional. Sesuaikan dengan konteks percakapan.';

    if (contextType === 'urgent') {
      styleInstructions = 'Konteks URGEN. Respons langsung dan efisien tanpa basa-basi. Bantu sesegera mungkin.';
    } else if (contextType === 'business') {
      styleInstructions = 'Konteks BISNIS. Gunakan bahasa profesional, informatif, dan terstruktur dengan baik.';
    }

    return {
      tone: 'friendly',
      styleInstructions,
      examples: [],
    };
  }

  /**
   * Update a contact's profile based on observed communication patterns.
   * This will be enhanced in Phase 4 with auto-learning.
   */
  async updateProfileFromInteraction(
    contactId: string,
    name: string,
    detectedTone?: string,
    detectedLanguage?: string,
  ): Promise<void> {
    const profile = this.memoryManager.loadContactProfile(contactId) || {
      contactId,
      name,
      tone: 'friendly' as const,
      updatedAt: new Date(),
    };

    if (detectedTone) {
      if (VALID_TONES.includes(detectedTone)) {
        profile.tone = detectedTone as ContactProfile['tone'];
      }
    }

    if (detectedLanguage) {
      profile.language = detectedLanguage;
    }

    profile.updatedAt = new Date();
    this.memoryManager.saveContactProfile(profile);
  }

  /**
   * Get all contacts with their style summaries.
   */
  listAllStyles(): Array<{ contactId: string; name: string; tone: string }> {
    const profiles = this.memoryManager.listContactProfiles();
    return profiles.map(p => {
      const profile = this.memoryManager.loadContactProfile(p.contactId);
      return {
        contactId: p.contactId,
        name: p.name,
        tone: profile?.tone || 'unknown',
      };
    });
  }
}
