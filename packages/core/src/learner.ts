import { Logger } from 'pino';
import { MemoryEntry, ContactProfile } from './types.js';
import { MemoryManager } from './memory-manager.js';
import { StyleRouter } from './style-router.js';
import { getLogger } from './logger.js';

// ── Types ───────────────────────────────────────────────────────

export interface LearningResult {
  /** Whether the profile was updated */
  profileUpdated: boolean;
  /** New facts extracted */
  factsExtracted: number;
  /** New patterns detected */
  patternsDetected: number;
  /** Corrections detected */
  correctionsApplied: number;
  /** Summary of what was learned */
  summary: string;
}

export interface StyleAnalysis {
  tone?: ContactProfile['tone'];
  language?: string;
  greetings?: string[];
  topics?: string[];
  emojiUsage?: ContactProfile['emojiUsage'];
}

export interface DetectedCorrection {
  type: 'tone' | 'greeting' | 'behavior' | 'fact' | 'name';
  description: string;
}

// ── Learner Class ───────────────────────────────────────────────

/**
 * Learner analyzes conversations to automatically detect:
 * 1. Communication style patterns (tone, language, greetings)
 * 2. Important facts from conversations
 * 3. User corrections and feedback
 * 4. Recurring communication patterns
 *
 * Uses rule-based heuristics for speed and reliability.
 * All analysis is synchronous and local (no AI calls).
 */
export class Learner {
  private logger: Logger;
  private memoryManager: MemoryManager;
  private styleRouter: StyleRouter;

  // Correction keywords (Bahasa Indonesia)
  private correctionPrefixes = [
    'jangan', 'bukan', 'salah', 'seharusnya', 'sebaiknya',
    'tolong jangan', 'g usah', 'nggak usah', 'tidak usah',
    'ubah', 'ganti', 'kalo bisa', 'coba',
    'maaf tapi', 'sorry tapi', 'eh',
  ];

  // Greeting detection patterns
  private greetingPatterns = [
    /^(halo|hai|hey|hi|helo|hy)\b/i,
    /^(selamat\s+(pagi|siang|sore|malam))\b/i,
    /^(assalamualaikum|assalam|asyik)\b/i,
    /^(bro|broo|boss|mas|mbak|pak|bu|kak|dek)\b/i,
    /^(test|tes|coba)\b/i,
  ];

  // Emoji frequency tracking
  private emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

  constructor(memoryManager: MemoryManager, styleRouter: StyleRouter) {
    this.logger = getLogger().child({ module: 'learner' });
    this.memoryManager = memoryManager;
    this.styleRouter = styleRouter;
  }

  /**
   * Main entry point: learn from a single interaction.
   * Called after each message is processed.
   */
  async learnFromInteraction(
    contactId: string,
    contactName: string,
    userMessage: string,
    aiResponse: string,
    recentEntries: MemoryEntry[],
  ): Promise<LearningResult> {
    const result: LearningResult = {
      profileUpdated: false,
      factsExtracted: 0,
      patternsDetected: 0,
      correctionsApplied: 0,
      summary: '',
    };

    const actions: string[] = [];

    // 1. Detect corrections from user message
    const corrections = this.detectCorrections(userMessage, aiResponse);
    if (corrections.length > 0) {
      const correctionPatterns = corrections.map(c => `Koreksi: ${c.description}`);
      this.saveLearnedPatterns(contactId, correctionPatterns);
      result.correctionsApplied = corrections.length;
      actions.push(`${result.correctionsApplied} koreksi`);
    }

    // 2. Record recent interaction
    const interactionSummary = this.summarizeInteraction(userMessage, aiResponse);
    this.recordInteraction(contactId, interactionSummary);

    // 3. Analyze style periodically (every ~10 interactions)
    const entryCount = recentEntries.length;
    if (entryCount >= 10 && Math.floor(entryCount / 10) > Math.floor((entryCount - 1) / 10)) {
      const analysis = this.analyzeStyle(recentEntries);
      if (analysis) {
        await this.applyStyleUpdate(contactId, contactName, analysis);
        result.profileUpdated = true;
        actions.push('gaya komunikasi');
      }
    }

    // 4. Extract facts (from user messages with key info)
    const facts = this.extractFactsFromMessage(userMessage);
    for (const fact of facts) {
      this.memoryManager.addFact(fact);
      result.factsExtracted++;
    }
    if (facts.length > 0) {
      actions.push(`${facts.length} fakta`);
    }

    // 5. Detect communication patterns
    const patterns = this.detectPatterns(recentEntries);
    if (patterns.length > 0) {
      this.saveLearnedPatterns(contactId, patterns);
      result.patternsDetected = patterns.length;
      actions.push(`${result.patternsDetected} pola`);
    }

    if (actions.length > 0) {
      result.summary = `Belajar: ${actions.join(', ')}`;
      this.logger.info({ contactId, result }, 'Learning completed for interaction');
    }

    return result;
  }

  // ── Style Analysis ────────────────────────────────────────────

  /**
   * Analyze recent conversation entries to detect communication style.
   */
  analyzeStyle(entries: MemoryEntry[]): StyleAnalysis | null {
    const userEntries = entries.filter(e => e.role === 'user');
    if (userEntries.length < 3) return null; // Need min 3 user messages

    const analysis: StyleAnalysis = {};

    // Detect tone from user messages
    const tone = this.detectTone(userEntries);
    if (tone) analysis.tone = tone;

    // Detect language/style
    const language = this.detectLanguage(userEntries);
    if (language) analysis.language = language;

    // Detect greetings
    const greetings = this.detectGreetings(userEntries);
    if (greetings.length > 0) analysis.greetings = greetings;

    // Detect topics (simple keyword frequency)
    const topics = this.extractTopics(userEntries);
    if (topics.length > 0) analysis.topics = topics;

    // Detect emoji usage
    const emojiUsage = this.detectEmojiUsage(userEntries);
    if (emojiUsage) analysis.emojiUsage = emojiUsage;

    return Object.keys(analysis).length > 0 ? analysis : null;
  }

  /**
   * Detect communication tone from user messages.
   */
  private detectTone(userEntries: MemoryEntry[]): ContactProfile['tone'] | undefined {
    const texts = userEntries.map(e => e.content);
    const totalMessages = texts.length;
    if (totalMessages === 0) return undefined;

    // Count tone indicators
    let formalScore = 0;
    let casualScore = 0;
    let friendlyScore = 0;

    // Formal indicators
    const formalPatterns = [
      /\b(saya|kami|anda|mohon|silakan|terima kasih)\b/i,
      /\b(hormat|dengan ini|perihal|permohonan)\b/i,
      /^\s*(selamat\s+(pagi|siang|sore|malam))\b/i,
    ];

    // Casual indicators
    const casualPatterns = [
      /\b(gua|gue|lu|elo|aku|kamu)\b/i,
      /\b(banget|dongs|kwk|wkwk|wkwkwk|haha|hehe)\b/i,
      /\b(yg|g|ga|nggak|gak|udah|dah|aja|doang)\b/i,
      /\b(sih|dong|kok|lah|deh|nih|tuh)\b/i,
    ];

    // Friendly indicators
    const friendlyPatterns = [
      /\b(salam|makasih|thanks|thx|mkasih)\b/i,
      /[😊😁👍🙏❤️🎉😄😃]/gu,
    ];

    for (const text of texts) {
      for (const p of formalPatterns) {
        if (p.test(text)) { formalScore++; break; }
      }
      for (const p of casualPatterns) {
        if (p.test(text)) { casualScore++; break; }
      }
      for (const p of friendlyPatterns) {
        if (p.test(text)) { friendlyScore++; break; }
      }
    }

    // Normalize scores
    const total = formalScore + casualScore + friendlyScore || 1;

    // If formal dominates
    if (formalScore / total > 0.5) return 'formal';

    // If casual dominates and friendly present
    if (casualScore / total > 0.4) {
      if (friendlyScore > 0) return 'friendly';
      return 'casual';
    }

    // If friendly dominates
    if (friendlyScore / total > 0.4) return 'friendly';

    // If mixed
    if (casualScore > 0 && formalScore > 0) return 'mixed';

    return 'professional';
  }

  /**
   * Detect language mixing (Bahasa Indonesia + English).
   */
  private detectLanguage(userEntries: MemoryEntry[]): string | undefined {
    const texts = userEntries.map(e => e.content);
    let englishWordCount = 0;
    let totalWordCount = 0;

    const commonEnglishWords = new Set([
      'the', 'is', 'are', 'was', 'were', 'have', 'has', 'had',
      'do', 'does', 'did', 'can', 'could', 'will', 'would',
      'shall', 'should', 'may', 'might', 'must', 'need',
      'yes', 'no', 'ok', 'okay', 'please', 'thank', 'thanks',
      'sorry', 'hello', 'hi', 'hey', 'bye', 'goodbye',
      'order', 'price', 'product', 'info', 'help', 'support',
      'time', 'date', 'day', 'week', 'month', 'year',
      'how', 'what', 'when', 'where', 'why', 'who',
      'my', 'your', 'our', 'their', 'its',
      'not', 'but', 'and', 'or', 'for', 'with', 'about',
      'up', 'down', 'out', 'off', 'over', 'back',
    ]);

    for (const text of texts) {
      const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      totalWordCount += words.length;
      for (const word of words) {
        // Remove punctuation
        const clean = word.replace(/[^a-zA-Z]/g, '');
        if (clean.length > 2 && commonEnglishWords.has(clean)) {
          englishWordCount++;
        }
      }
    }

    if (totalWordCount === 0) return undefined;

    const englishRatio = englishWordCount / totalWordCount;

    if (englishRatio > 0.3) return 'Indonesia campur Inggris';
    if (englishRatio > 0.1) return 'Indonesia dengan sedikit Inggris';
    return 'Indonesia';
  }

  /**
   * Extract greetings used by the contact.
   */
  private detectGreetings(userEntries: MemoryEntry[]): string[] {
    const greetings = new Set<string>();

    for (const entry of userEntries) {
      const firstWord = entry.content.trim().split(/\s+/)[0];
      if (!firstWord) continue;

      for (const pattern of this.greetingPatterns) {
        const match = firstWord.match(pattern);
        if (match) {
          greetings.add(firstWord.toLowerCase());
          break;
        }
      }
    }

    return Array.from(greetings);
  }

  /**
   * Extract common topics from user messages.
   */
  private extractTopics(userEntries: MemoryEntry[]): string[] {
    const topicKeywords: Record<string, RegExp[]> = {
      'Produk': [/produk/i, /barang/i, /katalog/i, /item/i],
      'Harga': [/harga/i, /mahal/i, /murah/i, /biaya/i, /ongkir/i],
      'Pemesanan': [/order/i, /pesan/i, /beli/i, /checkout/i, /purchase/i],
      'Pengiriman': [/kirim/i, /sampai/i, /paket/i, /ekspedisi/i, /kurir/i],
      'Pembayaran': [/bayar/i, /transfer/i, /bank/i, /rekening/i, /dana/i, /gopay/i, /ovo/i],
      'Komplain': [/komplain/i, /rusak/i, /cacat/i, /salah/i, /error/i, /masalah/i],
      'Jadwal': [/jam/i, /bu[kaa]/i, /tutup/i, /jadwal/i, /operasional/i],
      'Info': [/info/i, /tanya/i, /tahu/i, /tau/i, /ketahui/i],
      'Akun': [/akun/i, /login/i, /password/i, /lupa/i, /daftar/i, /register/i],
      'Promo': [/promo/i, /diskon/i, /sale/i, /hemat/i, /bundling/i],
    };

    const topicCount: Record<string, number> = {};
    for (const entry of userEntries) {
      const text = entry.content;
      for (const [topic, patterns] of Object.entries(topicKeywords)) {
        for (const p of patterns) {
          if (p.test(text)) {
            topicCount[topic] = (topicCount[topic] || 0) + 1;
            break;
          }
        }
      }
    }

    // Return topics mentioned 2+ times
    return Object.entries(topicCount)
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([topic]) => topic);
  }

  /**
   * Detect emoji usage frequency.
   */
  private detectEmojiUsage(userEntries: MemoryEntry[]): ContactProfile['emojiUsage'] | undefined {
    let totalEmojis = 0;
    let totalChars = 0;

    for (const entry of userEntries) {
      totalChars += entry.content.length;
      const matches = entry.content.match(this.emojiRegex);
      if (matches) totalEmojis += matches.length;
    }

    if (totalChars === 0) return undefined;

    const emojiPerChar = totalEmojis / totalChars;

    if (emojiPerChar > 0.05) return 'frequent';
    if (emojiPerChar > 0.01) return 'moderate';
    if (totalEmojis > 0) return 'rare';

    return undefined;
  }

  /**
   * Apply detected style changes to a contact's profile.
   */
  private async applyStyleUpdate(
    contactId: string,
    contactName: string,
    analysis: StyleAnalysis,
  ): Promise<void> {
    const profile = this.memoryManager.loadContactProfile(contactId) || {
      contactId,
      name: contactName,
      tone: 'friendly' as const,
      updatedAt: new Date(),
    };

    let changed = false;

    if (analysis.tone && analysis.tone !== profile.tone) {
      profile.tone = analysis.tone;
      changed = true;
    }

    if (analysis.language && analysis.language !== profile.language) {
      profile.language = analysis.language;
      changed = true;
    }

    if (analysis.topics && analysis.topics.length > 0) {
      // Merge with existing topics
      const existing = new Set(profile.topics || []);
      for (const topic of analysis.topics) {
        existing.add(topic);
      }
      profile.topics = Array.from(existing);
      changed = true;
    }

    if (analysis.greetings && analysis.greetings.length > 0) {
      // Add new greetings not already present
      const existing = new Set((profile.greetings || []).map(g => g.toLowerCase()));
      for (const greeting of analysis.greetings) {
        if (!existing.has(greeting.toLowerCase())) {
          profile.greetings = [...(profile.greetings || []), greeting];
          existing.add(greeting.toLowerCase());
        }
      }
      changed = true;
    }

    if (analysis.emojiUsage && analysis.emojiUsage !== profile.emojiUsage) {
      profile.emojiUsage = analysis.emojiUsage;
      changed = true;
    }

    if (changed) {
      profile.updatedAt = new Date();
      this.memoryManager.saveContactProfile(profile);
      this.logger.info({ contactId, analysis }, 'Style profile auto-updated');
    }
  }

  // ── Correction Detection ──────────────────────────────────────

  /**
   * Detect if the user is giving a correction or feedback
   * about how the AI should behave.
   */
  detectCorrections(userMessage: string, aiResponse: string): DetectedCorrection[] {
    const corrections: DetectedCorrection[] = [];
    const lower = userMessage.toLowerCase().trim();

    // Check for correction prefixes
    const hasCorrectionPrefix = this.correctionPrefixes.some(p => lower.startsWith(p));
    if (!hasCorrectionPrefix && lower.length < 10) return corrections;

    // Tone correction: "jangan formal" / "jangan panggil pak"
    if (/jangan\s+(formal|kaku|sopan|resmi|kasar)/i.test(lower)) {
      corrections.push({
        type: 'tone',
        description: 'User menginginkan tone yang berbeda',
      });
    }

    // Greeting correction: "jangan panggil (saya|aku) (pak|bu|mas|mbak|kak)"
    const greetingMatch = lower.match(/jangan\s+(panggil|sapa|bilang)\s+(?:saya|aku|gue)?\s*(pak|bu|mas|mbak|kak|dek|bro|boss)/i);
    if (greetingMatch) {
      corrections.push({
        type: 'greeting',
        description: `Jangan panggil dengan "${greetingMatch[2]}"`,
      });
    }

    // Behavior correction: "jangan (lama|cepat|panjang|pendek)"
    if (/jangan\s+(lama|cepat|panjang|pendek|banyak|dikit|singkat|detail)/i.test(lower)) {
      corrections.push({
        type: 'behavior',
        description: `User mengoreksi panjang/durasi respons: "${lower.substring(0, 50)}"`,
      });
    }

    // "bukan begitu" / "salah" — general correction
    if (/^(bukan|salah|nggak\s+begitu|bukan\s+begitu)/i.test(lower)) {
      corrections.push({
        type: 'behavior',
        description: 'User mengoreksi jawaban AI: respon tidak sesuai',
      });
    }

    // "panggil saya (nama)" — name preference
    const nameMatch = lower.match(/panggil\s+(saya|aku)\s+(\w+)/i);
    if (nameMatch) {
      corrections.push({
        type: 'name',
        description: `User ingin dipanggil "${nameMatch[2]}"`,
      });
    }

    // General "ubah/ganti" — style change request (no specific pattern match)
    if (/^(ubah|ganti)\s+/i.test(lower) && corrections.length === 0) {
      corrections.push({
        type: 'behavior',
        description: `User meminta perubahan: "${lower.substring(0, 60)}"`,
      });
    }

    return corrections;
  }

  // ── Facts Extraction ──────────────────────────────────────────

  /**
   * Extract potential facts from a user message.
   * Uses simple patterns to identify important information.
   */
  extractFactsFromMessage(message: string): string[] {
    const facts: string[] = [];
    const trimmed = message.trim();

    // Personal info: "nama saya X" / "saya X"
    const nameMatch = trimmed.match(/(?:nama\s+saya|saya|aku)\s+(\w+(?:\s+\w+)?)\s*(?:dari|di|umur|usia)/i);
    if (nameMatch && !nameMatch[1].match(/^(ingin|mau|hendak|akan|bisa|ingin|perlu|butuh|punya|ada)$/i)) {
      facts.push(`User menyebutkan informasi personal: ${nameMatch[1].trim()}`);
    }

    // Contact info: "nomor saya X" / "wa saya X"
    const phoneMatch = trimmed.match(/(?:nomor|no|wa|telp|telepon|hp)\s+(?:saya|aku|kami)?\s*[:]?\s*(\d[\d\s\-]{5,})/i);
    if (phoneMatch) {
      facts.push(`User memberikan nomor kontak: ${phoneMatch[1].trim()}`);
    }

    // Preferences: "saya suka X" / "saya lebih suka X"
    const prefMatch = trimmed.match(/(?:saya|aku|gue)\s+(?:lebih\s+)?suka\s+(.+?)(?:\.|,|$|daripada)/i);
    if (prefMatch) {
      facts.push(`User menyukai: ${prefMatch[1].trim()}`);
    }

    // Time references: "besok" / "minggu depan" / "jam X"
    const timeMatch = trimmed.match(/(?:besok|minggu\s+depan|bulan\s+depan|hari\s+ini|nanti\s+(?:sore|malam|pagi))\b/i);
    if (timeMatch) {
      facts.push(`User menyebutkan waktu: ${timeMatch[0].toLowerCase()}`);
    }

    // Location: "di X" (simple location detection)
    const locMatch = trimmed.match(/(?:di|dari|ke)\s+(\w+(?:\s+\w+)?)\s*(?:ya|dong|sih|lah|deh|kak|mas|pak|bu)\s*$/i);
    if (locMatch && locMatch[1].length > 3) {
      facts.push(`User menyebutkan lokasi: ${locMatch[1].trim()}`);
    }

    // Action items: "tolong X" / "bantu X"
    const actionMatch = trimmed.match(/(?:tolong|bantu|minta|butuh)\s+(.+?)(?:\.|,|$|ya\b|dong\b)/i);
    if (actionMatch) {
      facts.push(`User membutuhkan: ${actionMatch[1].trim()}`);
    }

    return facts;
  }

  // ── Pattern Detection ─────────────────────────────────────────

  /**
   * Detect communication patterns from recent conversation entries.
   */
  detectPatterns(entries: MemoryEntry[]): string[] {
    const patterns: string[] = [];
    const userEntries = entries.filter(e => e.role === 'user');
    const assistantEntries = entries.filter(e => e.role === 'assistant');

    if (userEntries.length < 3) return patterns;

    // Average message length
    const avgUserLength = userEntries.reduce((sum, e) => sum + e.content.length, 0) / userEntries.length;
    const avgAssistantLength = assistantEntries.length > 0
      ? assistantEntries.reduce((sum, e) => sum + e.content.length, 0) / assistantEntries.length
      : 0;

    // Pattern: short responses
    if (avgUserLength < 30 && userEntries.length >= 5) {
      patterns.push('User cenderung memberi pesan pendek');
    }

    // Pattern: long responses
    if (avgUserLength > 200 && userEntries.length >= 5) {
      patterns.push('User cenderung memberi pesan panjang dan detail');
    }

    // Pattern: response length ratio
    if (avgAssistantLength > 0 && avgUserLength > 0) {
      const ratio = avgAssistantLength / avgUserLength;
      if (ratio > 3) {
        patterns.push('Agent perlu memberi respons lebih singkat');
      }
      if (ratio < 0.3) {
        patterns.push('Agent perlu memberi respons lebih panjang');
      }
    }

    // Pattern: question frequency
    const questionCount = userEntries.filter(e => e.content.includes('?')).length;
    if (questionCount > 0 && questionCount / userEntries.length > 0.5) {
      patterns.push('User sering bertanya (high question frequency)');
    }

    // Pattern: time-based (check timestamps for late-night activity)
    const nightMessages = userEntries.filter(e => {
      const hour = new Date(e.timestamp).getHours();
      return hour >= 22 || hour < 5;
    });
    if (nightMessages.length >= 3) {
      patterns.push('User sering chat malam hari (setelah jam 10 malam)');
    }

    return patterns;
  }

  // ── Full Conversation Analysis ─────────────────────────────────

  /**
   * Process a full conversation for a contact to learn everything possible.
   * Called periodically (e.g., when conversation summary is generated).
   */
  async processFullConversation(contactId: string, contactName: string): Promise<LearningResult> {
    const result: LearningResult = {
      profileUpdated: false,
      factsExtracted: 0,
      patternsDetected: 0,
      correctionsApplied: 0,
      summary: '',
    };

    const entries = this.memoryManager.readRecentMemory(contactId, 100);
    if (entries.length < 5) return result;

    const userEntries = entries.filter(e => e.role === 'user');
    const actions: string[] = [];

    // 1. Deep style analysis
    const analysis = this.analyzeStyle(entries);
    if (analysis) {
      await this.applyStyleUpdate(contactId, contactName, analysis);
      result.profileUpdated = true;
      actions.push('gaya komunikasi');
    }

    // 2. Extract example responses from user
    this.extractUserExamples(userEntries, contactId);
    if (userEntries.length > 5) actions.push('contoh respon');

    // 3. Detect patterns
    const patterns = this.detectPatterns(entries);
    if (patterns.length > 0) {
      this.saveLearnedPatterns(contactId, patterns);
      result.patternsDetected = patterns.length;
      actions.push(`${patterns.length} pola`);
    }

    // 4. Extract facts from user messages
    for (const entry of userEntries) {
      const facts = this.extractFactsFromMessage(entry.content);
      for (const fact of facts) {
        // Avoid duplicate facts
        const existingFacts = this.memoryManager.getFacts();
        if (!existingFacts.includes(fact)) {
          this.memoryManager.addFact(fact);
          result.factsExtracted++;
        }
      }
    }
    if (result.factsExtracted > 0) actions.push(`${result.factsExtracted} fakta`);

    if (actions.length > 0) {
      result.summary = `Analisis penuh: ${actions.join(', ')}`;
      this.logger.info({ contactId, result }, 'Full conversation analysis completed');
    }

    return result;
  }

  /**
   * Save learned patterns to contact profile (batch).
   * Menulis ke ## Pola yang Dipelajari section di profile markdown.
   */
  private saveLearnedPatterns(contactId: string, newPatterns: string[]): void {
    try {
      const profile = this.memoryManager.loadContactProfile(contactId);
      if (!profile) return;

      const existing = new Set(profile.learnedPatterns || []);
      for (const p of newPatterns) {
        existing.add(p);
      }
      profile.learnedPatterns = Array.from(existing).slice(-10);
      profile.updatedAt = new Date();
      this.memoryManager.saveContactProfile(profile);
    } catch { /* non-critical, silent fail */ }
  }

  /**
   * Record a recent interaction to contact profile.
   */
  private recordInteraction(contactId: string, interactionSummary: string): void {
    try {
      const profile = this.memoryManager.loadContactProfile(contactId);
      if (!profile) return;

      const today = new Date().toISOString().split('T')[0];
      const entry = `${today}: ${interactionSummary}`;

      const existing = profile.recentInteractions || [];
      existing.push(entry);
      profile.recentInteractions = existing.slice(-10);
      profile.updatedAt = new Date();
      this.memoryManager.saveContactProfile(profile);
    } catch { /* non-critical, silent fail */ }
  }

  /**
   * Create a one-line summary of an interaction for ## Interaksi Terbaru.
   */
  private summarizeInteraction(userMessage: string, aiResponse: string): string {
    const userPreview = userMessage.length > 60 ? userMessage.substring(0, 60) + '...' : userMessage;
    const aiPreview = aiResponse.length > 40 ? aiResponse.substring(0, 40) + '...' : aiResponse;
    return `${userPreview} → ${aiPreview}`;
  }

  /**
   * Extract example responses from user messages and add to profile.
   */
  private extractUserExamples(userEntries: MemoryEntry[], contactId: string): void {
    if (userEntries.length < 5) return;

    const profile = this.memoryManager.loadContactProfile(contactId);
    if (!profile) return;

    // Take diverse examples (first, middle, recent)
    const indices = [0, Math.floor(userEntries.length / 2), userEntries.length - 1];
    const examples: string[] = [];

    for (const idx of indices) {
      const content = userEntries[idx].content;
      if (content.length < 200 && content.length > 5) {
        examples.push(content.substring(0, 150));
      }
    }

    if (examples.length > 0) {
      profile.exampleResponses = [...new Set([...(profile.exampleResponses || []), ...examples])];
      profile.updatedAt = new Date();
      this.memoryManager.saveContactProfile(profile);
    }
  }
}
