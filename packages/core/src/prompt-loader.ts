import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { decode } from '@toon-format/toon';
import { getLogger } from './logger.js';

/**
 * PromptLoader loads and parses TOON prompt files.
 * Used for personality, summarizer, and skill prompts.
 */
export class PromptLoader {
  private static instance: PromptLoader;
  private cache: Map<string, any> = new Map();
  private promptsDir: string;

  private constructor() {
    // Find prompts directory
    const possiblePaths = [
      join(process.cwd(), 'prompts'),
      join(__dirname, '../prompts'),
      join(__dirname, '../../prompts'),
    ];
    
    this.promptsDir = possiblePaths.find(p => existsSync(p)) || possiblePaths[0];
  }

  static getInstance(): PromptLoader {
    if (!PromptLoader.instance) {
      PromptLoader.instance = new PromptLoader();
    }
    return PromptLoader.instance;
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
      getLogger().info(`Loaded prompt file: ${filePath}`);
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
}

// Export singleton
export const promptLoader = PromptLoader.getInstance();