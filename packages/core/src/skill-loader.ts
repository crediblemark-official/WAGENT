import { Logger } from 'pino';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, resolve, extname } from 'path';
import { SkillDefinition, SkillFactory, ToolDefinition } from './types.js';
import { getLogger } from './logger.js';
import { promptLoader } from './prompt-loader.js';

export class SkillLoader {
  private skills: Map<string, SkillDefinition> = new Map();
  private logger: Logger;
  private skillsDir: string;

  constructor(skillsDir?: string) {
    this.logger = getLogger().child({ module: 'skill-loader' });
    this.skillsDir = resolve(skillsDir || join(process.cwd(), 'skills'));
  }

  getSkillsDir(): string {
    return this.skillsDir;
  }

  getLoadedSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  getSkill(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  getTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const skill of this.skills.values()) {
      tools.push(...skill.tools);
    }
    return tools;
  }

  getSystemPromptAdditions(): string {
    const additions: string[] = [];
    for (const skill of this.skills.values()) {
      if (skill.manifest.systemPromptAdditions) {
        additions.push(skill.manifest.systemPromptAdditions);
      }
    }
    return additions.join('\n');
  }

  async loadAll(): Promise<void> {
    if (!existsSync(this.skillsDir)) {
      this.logger.info('Skills directory not found: %s', this.skillsDir);
      return;
    }

    const entries = readdirSync(this.skillsDir);
    const skillFiles = entries.filter(f =>
      (f.endsWith('.js') || f.endsWith('.mjs')) &&
      statSync(join(this.skillsDir, f)).isFile()
    );

    this.logger.info('Found %d skill files in %s', skillFiles.length, this.skillsDir);

    for (const file of skillFiles) {
      await this.loadSkillFile(file);
    }

    this.logger.info('Loaded %d skills with %d total tools',
      this.skills.size, this.getTools().length);
  }

  async loadSkillFile(filename: string): Promise<SkillDefinition | null> {
    try {
      const filePath = join(this.skillsDir, filename);
      const module = await import(filePath);

      // Look for a default export that is a SkillFactory
      const factory: SkillFactory | undefined = module.default;
      if (typeof factory !== 'function') {
        this.logger.warn('Skill file %s has no default export function, skipping', filename);
        return null;
      }

      const skill = await factory();
      this.validateSkill(skill, filename);
      
      // Inject prompt from skills.toon if not set in skill manifest
      if (!skill.manifest.systemPromptAdditions) {
        const toonPrompt = promptLoader.getSkillPrompt(skill.manifest.name);
        if (toonPrompt) {
          skill.manifest.systemPromptAdditions = toonPrompt;
          this.logger.info('Injected prompt from skills.toon for skill: %s', skill.manifest.name);
        }
      }
      
      this.skills.set(skill.manifest.name, skill);
      this.logger.info('Loaded skill: %s v%s', skill.manifest.name, skill.manifest.version);
      return skill;
    } catch (err: any) {
      this.logger.error({ error: err.message, file: filename }, 'Failed to load skill');
      return null;
    }
  }

  async reloadSkill(name: string): Promise<boolean> {
    this.skills.delete(name);
    // ESM caches imports, so we reload with a cache-busting query param
    try {
      const entry = this.skillsDir;
      const files = readdirSync(entry);
      for (const file of files) {
        if (file.endsWith('.js') || file.endsWith('.mjs')) {
          const filePath = join(entry, file);
          const cacheBustPath = `${filePath}?t=${Date.now()}`;
          const module = await import(cacheBustPath);
          const factory = module.default;
          if (typeof factory === 'function') {
            const skill = await factory();
            if (skill.manifest.name === name) {
              this.validateSkill(skill, file);
              this.skills.set(name, skill);
              this.logger.info('Reloaded skill: %s v%s', name, skill.manifest.version);
              return true;
            }
          }
        }
      }
    } catch (err: any) {
      this.logger.error({ error: err.message, skill: name }, 'Failed to reload skill');
    }
    return false;
  }

  removeSkill(name: string): boolean {
    return this.skills.delete(name);
  }

  async findSkillFile(name: string): Promise<string | null> {
    if (!existsSync(this.skillsDir)) return null;
    const files = readdirSync(this.skillsDir).filter(f =>
      (f.endsWith('.js') || f.endsWith('.mjs')) &&
      statSync(join(this.skillsDir, f)).isFile()
    );
    for (const file of files) {
      try {
        const filePath = join(this.skillsDir, file);
        const module = await import(`${filePath}?t=${Date.now()}`);
        const factory = module.default;
        if (typeof factory === 'function') {
          const skill = await factory();
          if (skill.manifest.name === name) {
            return filePath;
          }
        }
      } catch { /* skip invalid files */ }
    }
    return null;
  }

  private validateSkill(skill: SkillDefinition, filename: string): void {
    if (!skill.manifest?.name) {
      throw new Error(`Skill in ${filename} has no name in manifest`);
    }
    if (!skill.manifest?.version) {
      throw new Error(`Skill "${skill.manifest.name}" has no version`);
    }
    if (!Array.isArray(skill.tools)) {
      throw new Error(`Skill "${skill.manifest.name}" has no tools array`);
    }
    for (const tool of skill.tools) {
      if (!tool.name) {
        throw new Error(`Skill "${skill.manifest.name}" has a tool without a name`);
      }
    }
  }
}
