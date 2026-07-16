/**
 * PromptGenerator - AI-guided setup untuk generate prompt files
 * 
 * Uses AI to generate system.toon, personality.toon, messages.toon, 
 * and skills.toon based on user answers.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getLogger } from '../utils/logger.js';
import { WAgentConfig } from '../types.js';
import { promptLoader } from './prompt-loader.js';

interface SetupAnswers {
  // Business Info
  businessName: string;
  businessType: string;
  businessDescription: string;
  targetCustomer: string;

  // Personality
  tone: 'casual' | 'formal' | 'professional' | 'friendly';
  emojiUsage: 'rare' | 'moderate' | 'frequent';
  language: string;
  greeting?: string;

  // Common Questions
  frequentQuestions: string[];
  orderProcess: string;
  paymentMethods: string;
  shippingTime: string;
  returnPolicy: string;

  // Rules
  forbiddenActions: string[];
  escalationTriggers: string[];
  workingHours: string;

  // Features
  features: string[];

  // Messages
  welcomeMessage?: string;
  errorMessage?: string;
  offlineMessage?: string;
}

export class PromptGenerator {
  private logger = getLogger().child({ module: 'prompt-generator' });
  private config: WAgentConfig;
  private promptsDir: string;

  constructor(config: WAgentConfig) {
    this.config = config;
    this.promptsDir = join(process.cwd(), 'prompts');
  }

  /**
   * Generate all 4 prompt files from answers
   */
  async generateAll(answers: SetupAnswers): Promise<void> {
    // Ensure prompts directory exists
    if (!existsSync(this.promptsDir)) {
      mkdirSync(this.promptsDir, { recursive: true });
    }

    // Generate each file
    const systemPrompt = this.generateSystemPrompt(answers);
    const personalityPrompt = this.generatePersonalityPrompt(answers);
    const messagesPrompt = this.generateMessagesPrompt(answers);
    const skillsPrompt = this.generateSkillsPrompt(answers);

    // Write files
    writeFileSync(join(this.promptsDir, 'system.toon'), systemPrompt, 'utf-8');
    writeFileSync(join(this.promptsDir, 'personality.toon'), personalityPrompt, 'utf-8');
    writeFileSync(join(this.promptsDir, 'messages.toon'), messagesPrompt, 'utf-8');
    writeFileSync(join(this.promptsDir, 'skills.toon'), skillsPrompt, 'utf-8');

    this.logger.info('Generated all prompt files');
  }

  /**
   * Generate system.toon
   */
  private generateSystemPrompt(answers: SetupAnswers): string {
    const lines: string[] = [];

    // Role
    lines.push(`role: ${answers.businessType.replace(/\s+/g, '-').toLowerCase()}-ai`);
    lines.push(`language: ${answers.language}`);
    lines.push(`style: ${answers.tone}`);
    lines.push('');

    // Personality
    lines.push('personality[5]:');
    lines.push(`  - Kamu adalah AI customer service untuk ${answers.businessName}`);
    lines.push(`  - ${answers.businessDescription}`);
    lines.push(`  - Target customer: ${answers.targetCustomer}`);
    lines.push('  - Ramah, profesional, dan membantu');
    lines.push('  - Selalu prioritaskan kepuasan customer');
    lines.push('');

    // Speaking Style
    const speakingStyleCount = 6 + (answers.greeting ? 1 : 0);
    lines.push(`speaking-style[${speakingStyleCount}]:`);
    lines.push(`  - Gunakan bahasa ${answers.language} yang alami`);
    if (answers.greeting) {
      lines.push(`  - Sapaan khusus: "${answers.greeting}"`);
    }
    lines.push('  - Variasikan gaya balasan sesuai konteks');
    lines.push('  - Jangan terlalu kaku dan jangan terlalu panjang');
    lines.push('  - Gunakan emoji secukupnya untuk kesan ramah');
    lines.push('  - Hindari frasa kaku dan formalitas berlebihan');
    lines.push('  - Akhiri dengan tawaran bantuan lebih lanjut');
    lines.push('');

    // Rules
    const rulesCount = 2 + (answers.forbiddenActions.length > 0 ? answers.forbiddenActions.length : 2) + (answers.escalationTriggers.length > 0 ? 1 : 0) + 1;
    lines.push(`rules[${rulesCount}]:`);
    lines.push('  - Jangan sebut diri sendiri AI kecuali ditanya');
    lines.push('  - Jika tidak tahu jawabannya akui dengan jujur');
    if (answers.forbiddenActions.length > 0) {
      for (const action of answers.forbiddenActions) {
        lines.push(`  - Jangan ${action.toLowerCase()}`);
      }
    } else {
      lines.push('  - Jangan membuat informasi palsu');
      lines.push('  - Jangan meminta data sensitif');
    }
    if (answers.escalationTriggers.length > 0) {
      lines.push(`  - Eskalasi ke manusia jika: ${answers.escalationTriggers.join(', ')}`);
    }
    lines.push('  - Jika ada pertanyaan di luar konteks, arahkan dengan sopan');
    lines.push('');

    // Format
    lines.push('format[4]:');
    lines.push('  - Balasan singkat untuk pertanyaan sederhana');
    lines.push('  - Balasan lebih panjang jika perlu menjelaskan');
    lines.push('  - Gunakan poin-poin jika ada beberapa informasi');
    lines.push('  - Akhiri dengan tawaran bantuan lebih lanjut');
    lines.push('');

    // Reminder
    lines.push('reminder: Kamu adalah customer service yang alami dan menyenangkan diajak bicara');

    return lines.join('\n');
  }

  /**
   * Generate personality.toon
   */
  private generatePersonalityPrompt(answers: SetupAnswers): string {
    const lines: string[] = [];

    lines.push('tones:');
    lines.push('  casual:');
    lines.push('    description: santai dan natural');
    lines.push('    instruction: Gunakan bahasa yang santai dan natural. Boleh pakai slang dan bahasa sehari-hari.');
    lines.push('');
    lines.push('  formal:');
    lines.push('    description: formal dan sopan');
    lines.push('    instruction: Gunakan bahasa yang formal dan sopan. Hindari slang dan singkatan.');
    lines.push('');
    lines.push('  professional:');
    lines.push('    description: profesional dan ramah');
    lines.push('    instruction: Gunakan bahasa profesional namun tetap ramah. Seimbang antara formal dan santai.');
    lines.push('');
    lines.push('  friendly:');
    lines.push('    description: ramah dan hangat');
    lines.push('    instruction: Gunakan bahasa yang ramah dan hangat. Gunakan emoji secukupnya.');
    lines.push('');
    lines.push('  mixed:');
    lines.push('    description: adaptif mengikuti lawan bicara');
    lines.push('    instruction: Sesuaikan gaya dengan konteks percakapan. Ikuti gaya dari lawan bicara.');
    lines.push('');

    lines.push('emoji:');
    lines.push('  rare: Hindari emoji.');
    lines.push('  moderate: Gunakan emoji sesekali.');
    lines.push('  frequent: Boleh sering menggunakan emoji.');
    lines.push('');

    lines.push('context:');
    lines.push('  urgent: Konteks: URGEN. Respons harus langsung, efisien, dan to the point. Hindari basa-basi.');
    lines.push('  business: Konteks: BISNIS. Gunakan bahasa yang profesional, informatif, dan terstruktur.');
    lines.push('  default: Gunakan gaya yang ramah dan profesional. Sesuaikan dengan konteks percakapan.');
    lines.push('  urgent_default: Konteks URGEN. Respons langsung dan efisien tanpa basa-basi. Bantu sesegera mungkin.');
    lines.push('  business_default: Konteks BISNIS. Gunakan bahasa profesional, informatif, dan terstruktur dengan baik.');

    return lines.join('\n');
  }

  /**
   * Generate messages.toon
   */
  private generateMessagesPrompt(answers: SetupAnswers): string {
    const lines: string[] = [];

    const welcome = answers.welcomeMessage || `Halo! ${answers.greeting || 'Ada yang bisa saya bantu hari ini?'}`;
    const error = answers.errorMessage || 'Maaf, saya mengalami kendala teknis. Silakan coba lagi nanti.';
    const offline = answers.offlineMessage || 'Mohon maaf, saat ini di luar jam operasional.';

    lines.push(`welcome: ${welcome}`);
    lines.push('rate_limit: Mohon tunggu sebentar ya.');
    lines.push(`offline: ${offline}`);
    lines.push(`error_technical: ${error}`);

    return lines.join('\n');
  }

  /**
   * Generate skills.toon
   */
  private generateSkillsPrompt(answers: SetupAnswers): string {
    const lines: string[] = [];

    if (answers.features.includes('hitung_ongkir')) {
      lines.push('shipping:');
      lines.push('  name: shipping');
      lines.push('  prompt: Kamu bisa menghitung ongkos kirim menggunakan tool hitung_ongkir. Untuk menghitung ongkir, kamu perlu: kota asal, kota tujuan, berat (gram), dan kurir. Selalu tanyakan berat barang dan kota tujuan sebelum menghitung.');
      lines.push('');
    }

    if (answers.features.includes('bayar')) {
      lines.push('payment:');
      lines.push('  name: payment');
      lines.push('  prompt: Kamu bisa memproses pembayaran menggunakan tool yang tersedia. Selalu konfirmasi total sebelum memproses pembayaran.');
      lines.push('');
    }

    if (answers.features.includes('cek_pesanan')) {
      lines.push('order:');
      lines.push('  name: order');
      lines.push('  prompt: Kamu bisa mengecek status pesanan menggunakan tool yang tersedia. Tanyakan nomor pesanan atau nama customer.');
      lines.push('');
    }

    if (answers.features.includes('jadwal')) {
      lines.push('appointment:');
      lines.push('  name: appointment');
      lines.push('  prompt: Kamu bisa mengelola jadwal appointment menggunakan tool yang tersedia. Tanyakan tanggal, waktu, dan jenis layanan.');
      lines.push('');
    }

    if (answers.features.includes('inventori')) {
      lines.push('inventory:');
      lines.push('  name: inventory');
      lines.push('  prompt: Kamu bisa mengecek stok barang menggunakan tool yang tersedia. Tanyakan nama atau kode barang.');
      lines.push('');
    }

    // Add common questions as knowledge
    if (answers.frequentQuestions.length > 0) {
      lines.push('knowledge:');
      lines.push('  name: knowledge');
      lines.push(`  prompt: Pertanyaan yang sering ditanyakan: ${answers.frequentQuestions.join('; ')}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Generate prompts using AI (for more natural results)
   */
  async generateWithAI(answers: SetupAnswers): Promise<void> {
    const prompt = this.buildAIPrompt(answers);

    // Try AI generation, fall back to template if unavailable
    try {
      const resolved = this.config.resolvedModel;
      if (!resolved?.apiKey) {
        this.logger.warn('No AI model configured, falling back to template generation');
        await this.generateAll(answers);
        return;
      }

      const baseUrl = resolved.baseUrl || 'https://api.openai.com/v1';
      const cleanUrl = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/chat/completions`;

      const response = await fetch(cleanUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolved.apiKey}`,
        },
        body: JSON.stringify({
          model: resolved.model,
          messages: [
            { role: 'system', content: 'Kamu adalah AI yang membuat prompt files untuk customer service. Balas HANYA dengan JSON yang berisi 4 key: "system", "personality", "messages", "skills". Setiap value adalah string TOON format. Tidak ada penjelasan, tidak ada markdown.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 4000,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI API error: ${response.status}`);
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('Empty AI response');
      }

      // Parse JSON response
      const parsed = JSON.parse(content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());

      // Ensure prompts directory exists
      if (!existsSync(this.promptsDir)) {
        mkdirSync(this.promptsDir, { recursive: true });
      }

      // Write AI-generated files
      if (parsed.system) writeFileSync(join(this.promptsDir, 'system.toon'), parsed.system, 'utf-8');
      if (parsed.personality) writeFileSync(join(this.promptsDir, 'personality.toon'), parsed.personality, 'utf-8');
      if (parsed.messages) writeFileSync(join(this.promptsDir, 'messages.toon'), parsed.messages, 'utf-8');
      if (parsed.skills) writeFileSync(join(this.promptsDir, 'skills.toon'), parsed.skills, 'utf-8');

      this.logger.info('Generated prompt files using AI');
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'AI generation failed, falling back to template');
      await this.generateAll(answers);
    }
  }

  private getTemplatesDir(): string {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const paths = [
      join(currentDir, '../../prompts'),
      join(currentDir, '../prompts'),
    ];
    const resolved = paths.find(p => existsSync(p));
    return resolved || paths[0];
  }

  private loadTemplate(filename: string): string {
    try {
      const templatesDir = this.getTemplatesDir();
      const path = join(templatesDir, filename);
      if (existsSync(path)) {
        return readFileSync(path, 'utf-8');
      }
    } catch (e) {
      // ignore
    }
    return '';
  }

  private buildAIPrompt(answers: SetupAnswers): string {
    const systemGenInstructions = this.loadTemplate('system.toon');
    const personalityGenInstructions = this.loadTemplate('personality.toon');
    const messagesGenInstructions = this.loadTemplate('messages.toon');

    return `Buatkan 4 file prompt untuk AI customer service WhatsApp berdasarkan data owner berikut:

Bisnis: ${answers.businessName}
Jenis: ${answers.businessType}
Deskripsi: ${answers.businessDescription}
Target: ${answers.targetCustomer}

Gaya bicara: ${answers.tone}
Emoji: ${answers.emojiUsage}
Bahasa: ${answers.language}

Pertanyaan sering ditanyakan:
${answers.frequentQuestions.join('\n')}

Pembayaran: ${answers.paymentMethods}
Pengiriman: ${answers.shippingTime}
Retur: ${answers.returnPolicy}

Yang dilarang:
${answers.forbiddenActions.join('\n')}

Eskalasi jika:
${answers.escalationTriggers.join('\n')}

Jam operasional: ${answers.workingHours}

Fitur: ${answers.features.join(', ')}

Panduan struktur dan format berkas kustom yang harus dihasilkan:

1. system.toon (Persona AI):
${systemGenInstructions || 'Hasilkan berkas system.toon yang mendefinisikan persona AI.'}

2. personality.toon (Gaya bicara):
${personalityGenInstructions || 'Hasilkan berkas personality.toon yang mendefinisikan gaya bahasa kustom AI.'}

3. messages.toon (Pesan default):
${messagesGenInstructions || 'Hasilkan berkas messages.toon yang berisi pesan-pesan default untuk respon otomatis.'}

4. skills.toon (Skill aktif):
Hasilkan objek konfigurasi format TOON yang memuat skill/fitur aktif dari daftar di atas (misal: shipping, weather, payment, pos-connector).

Balas HANYA dengan JSON yang berisi 4 key: "system", "personality", "messages", "skills". Setiap value adalah string TOON format. Tidak ada penjelasan, tidak ada markdown.`;
  }
}
