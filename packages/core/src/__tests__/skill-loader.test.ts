import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { SkillLoader } from '../services/skill-loader.js';
import { SkillDefinition } from '../types.js';

vi.mock('../utils/logger.js', () => {
  const noop = vi.fn();
  const child = vi.fn(() => ({
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child,
  }));
  return {
    getLogger: vi.fn(() => ({
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      child,
    })),
  };
});

vi.mock('../agent/prompt-loader.js', () => ({
  promptLoader: {
    getSkillPrompt: vi.fn().mockReturnValue(null),
  },
}));

const TMP_DIR = join(__dirname, 'tmp-skill-loader-test');

function makeSkillModule(overrides: Partial<SkillDefinition> = {}) {
  return `export default async function() {
    return {
      manifest: {
        name: "${overrides.manifest?.name || 'test-skill'}",
        version: "${overrides.manifest?.version || '1.0.0'}",
        description: "${overrides.manifest?.description || 'A test skill'}",
      },
      tools: ${JSON.stringify(overrides.tools || [
        {
          name: 'test-tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
          handler: 'async () => "ok"',
        },
      ])}
    };
  }`;
}

function makeSkillModuleSync(overrides: Partial<SkillDefinition> = {}) {
  return `export default function() {
    return {
      manifest: {
        name: "${overrides.manifest?.name || 'test-skill'}",
        version: "${overrides.manifest?.version || '1.0.0'}",
        description: "${overrides.manifest?.description || 'A test skill'}",
      },
      tools: ${JSON.stringify(overrides.tools || [
        {
          name: 'test-tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
          handler: 'async () => "ok"',
        },
      ])}
    };
  }`;
}

describe('SkillLoader', () => {
  let loader: SkillLoader;

  beforeEach(() => {
    if (!existsSync(TMP_DIR)) {
      mkdirSync(TMP_DIR, { recursive: true });
    }
    loader = new SkillLoader(TMP_DIR);
  });

  afterEach(async () => {
    if (existsSync(TMP_DIR)) {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
    const { promptLoader } = await import('../agent/prompt-loader.js');
    (promptLoader.getSkillPrompt as ReturnType<typeof vi.fn>).mockReturnValue(null);
    vi.clearAllMocks();
  });

  describe('getSkillsDir', () => {
    it('should return the configured skills directory', () => {
      expect(loader.getSkillsDir()).toBe(TMP_DIR);
    });

    it('should default to cwd/skills when no dir provided', () => {
      const defaultLoader = new SkillLoader();
      expect(defaultLoader.getSkillsDir()).toContain('skills');
    });
  });

  describe('loadAll', () => {
    it('should load all .js/.mjs/.ts files from the skills directory', async () => {
      writeFileSync(join(TMP_DIR, 'skill-a.js'), makeSkillModule({ manifest: { name: 'skill-a', version: '1.0.0', description: 'A' } } as any), 'utf-8');
      writeFileSync(join(TMP_DIR, 'skill-b.mjs'), makeSkillModule({ manifest: { name: 'skill-b', version: '2.0.0', description: 'B' } } as any), 'utf-8');

      await loader.loadAll();

      const skills = loader.getLoadedSkills();
      expect(skills).toHaveLength(2);
      const names = skills.map(s => s.manifest.name).sort();
      expect(names).toEqual(['skill-a', 'skill-b']);
    });

    it('should skip non-script files', async () => {
      writeFileSync(join(TMP_DIR, 'readme.txt'), 'not a skill', 'utf-8');
      writeFileSync(join(TMP_DIR, 'skill.js'), makeSkillModule(), 'utf-8');

      await loader.loadAll();

      expect(loader.getLoadedSkills()).toHaveLength(1);
    });

    it('should return early if skills directory does not exist', async () => {
      const missingLoader = new SkillLoader(join(TMP_DIR, 'does-not-exist'));
      await missingLoader.loadAll();
      expect(missingLoader.getLoadedSkills()).toHaveLength(0);
    });

    it('should log count of loaded skills and tools', async () => {
      writeFileSync(join(TMP_DIR, 'a.js'), makeSkillModule({ manifest: { name: 'a', version: '1.0.0', description: 'A' } } as any), 'utf-8');

      await loader.loadAll();

      const { getLogger } = await import('../utils/logger.js');
      const logger = (getLogger as any)();
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe('loadSkillFile', () => {
    it('should load a valid skill file and return SkillDefinition', async () => {
      writeFileSync(join(TMP_DIR, 'valid-skill.js'), makeSkillModule(), 'utf-8');

      const result = await loader.loadSkillFile('valid-skill.js');

      expect(result).not.toBeNull();
      expect(result!.manifest.name).toBe('test-skill');
      expect(result!.manifest.version).toBe('1.0.0');
      expect(result!.tools).toHaveLength(1);
      expect(result!.tools[0].name).toBe('test-tool');
    });

    it('should store loaded skill in internal map', async () => {
      writeFileSync(join(TMP_DIR, 'stored.js'), makeSkillModule({ manifest: { name: 'stored-skill', version: '1.0.0', description: 'S' } } as any), 'utf-8');

      await loader.loadSkillFile('stored.js');

      expect(loader.getSkill('stored-skill')).toBeDefined();
      expect(loader.getSkill('stored-skill')!.manifest.name).toBe('stored-skill');
    });

    it('should reject file with no default export function', async () => {
      writeFileSync(join(TMP_DIR, 'no-export.js'), 'export const x = 42;', 'utf-8');

      const result = await loader.loadSkillFile('no-export.js');

      expect(result).toBeNull();
    });

    it('should reject invalid manifest - missing name', async () => {
      writeFileSync(join(TMP_DIR, 'no-name.js'), `export default async function() {
        return {
          manifest: { version: '1.0.0', description: 'No name' },
          tools: [],
        };
      }`, 'utf-8');

      const result = await loader.loadSkillFile('no-name.js');

      expect(result).toBeNull();
    });

    it('should reject missing tools array', async () => {
      writeFileSync(join(TMP_DIR, 'no-tools.js'), `export default async function() {
        return {
          manifest: { name: 'no-tools', version: '1.0.0', description: 'No tools' },
          tools: "not-an-array",
        };
      }`, 'utf-8');

      const result = await loader.loadSkillFile('no-tools.js');

      expect(result).toBeNull();
    });

    it('should reject tool without name', async () => {
      writeFileSync(join(TMP_DIR, 'bad-tool.js'), `export default async function() {
        return {
          manifest: { name: 'bad-tool', version: '1.0.0', description: 'Bad' },
          tools: [{ description: 'no name', parameters: {}, handler: async () => 'x' }],
        };
      }`, 'utf-8');

      const result = await loader.loadSkillFile('bad-tool.js');

      expect(result).toBeNull();
    });

    it('should return null for non-existent file', async () => {
      const result = await loader.loadSkillFile('nonexistent.js');
      expect(result).toBeNull();
    });

    it('should handle sync factory function', async () => {
      writeFileSync(join(TMP_DIR, 'sync-skill.js'), makeSkillModuleSync({ manifest: { name: 'sync-skill', version: '1.0.0', description: 'Sync' } } as any), 'utf-8');

      const result = await loader.loadSkillFile('sync-skill.js');

      expect(result).not.toBeNull();
      expect(result!.manifest.name).toBe('sync-skill');
    });

    it('should inject prompt from promptLoader when systemPromptAdditions is not set', async () => {
      const { promptLoader } = await import('../agent/prompt-loader.js');
      (promptLoader.getSkillPrompt as any).mockReturnValue('injected prompt text');

      writeFileSync(join(TMP_DIR, 'prompt-skill.js'), makeSkillModule({ manifest: { name: 'prompt-skill', version: '1.0.0', description: 'P' } } as any), 'utf-8');

      const result = await loader.loadSkillFile('prompt-skill.js');

      expect(result).not.toBeNull();
      expect(result!.manifest.systemPromptAdditions).toBe('injected prompt text');
    });

    it('should not overwrite existing systemPromptAdditions', async () => {
      const { promptLoader } = await import('../agent/prompt-loader.js');
      (promptLoader.getSkillPrompt as any).mockReturnValue('injected');

      writeFileSync(join(TMP_DIR, 'existing-prompt.js'), `export default async function() {
        return {
          manifest: { name: 'ep', version: '1.0.0', description: 'E', systemPromptAdditions: 'original' },
          tools: [],
        };
      }`, 'utf-8');

      const result = await loader.loadSkillFile('existing-prompt.js');

      expect(result!.manifest.systemPromptAdditions).toBe('original');
    });
  });

  describe('getTools', () => {
    it('should return all tool definitions from all loaded skills', async () => {
      writeFileSync(join(TMP_DIR, 's1.js'), makeSkillModule({ manifest: { name: 's1', version: '1.0.0', description: '' } } as any), 'utf-8');
      writeFileSync(join(TMP_DIR, 's2.js'), makeSkillModule({
        manifest: { name: 's2', version: '1.0.0', description: '' } as any,
        tools: [
          { name: 'tool-a', description: 'A', parameters: {}, handler: 'async () => "a"' } as any,
          { name: 'tool-b', description: 'B', parameters: {}, handler: 'async () => "b"' } as any,
        ],
      }), 'utf-8');

      await loader.loadAll();

      const tools = loader.getTools();
      expect(tools.length).toBe(3);
      const toolNames = tools.map(t => t.name).sort();
      expect(toolNames).toEqual(['test-tool', 'tool-a', 'tool-b']);
    });

    it('should return empty array when no skills loaded', () => {
      expect(loader.getTools()).toEqual([]);
    });
  });

  describe('getLoadedSkills', () => {
    it('should return all loaded skills', async () => {
      writeFileSync(join(TMP_DIR, 'x.js'), makeSkillModule({ manifest: { name: 'x', version: '1.0.0', description: 'X' } } as any), 'utf-8');

      await loader.loadSkillFile('x.js');

      const skills = loader.getLoadedSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].manifest.name).toBe('x');
    });

    it('should return empty array initially', () => {
      expect(loader.getLoadedSkills()).toEqual([]);
    });
  });

  describe('getSkill', () => {
    it('should return skill by name', async () => {
      writeFileSync(join(TMP_DIR, 'named.js'), makeSkillModule({ manifest: { name: 'named', version: '1.0.0', description: '' } } as any), 'utf-8');

      await loader.loadSkillFile('named.js');

      expect(loader.getSkill('named')).toBeDefined();
      expect(loader.getSkill('named')!.manifest.name).toBe('named');
    });

    it('should return undefined for unknown skill', () => {
      expect(loader.getSkill('nonexistent')).toBeUndefined();
    });
  });

  describe('getSystemPromptAdditions', () => {
    it('should join all systemPromptAdditions from skills', async () => {
      writeFileSync(join(TMP_DIR, 'p1.js'), `export default async function() {
        return {
          manifest: { name: 'p1', version: '1.0.0', description: '', systemPromptAdditions: 'prompt one' },
          tools: [],
        };
      }`, 'utf-8');
      writeFileSync(join(TMP_DIR, 'p2.js'), `export default async function() {
        return {
          manifest: { name: 'p2', version: '1.0.0', description: '', systemPromptAdditions: 'prompt two' },
          tools: [],
        };
      }`, 'utf-8');

      await loader.loadAll();

      const additions = loader.getSystemPromptAdditions();
      expect(additions).toContain('prompt one');
      expect(additions).toContain('prompt two');
      expect(additions).toContain('\n');
    });

    it('should return empty string when no skills have additions', async () => {
      writeFileSync(join(TMP_DIR, 'no-prompt.js'), makeSkillModule({ manifest: { name: 'np', version: '1.0.0', description: '' } } as any), 'utf-8');

      await loader.loadSkillFile('no-prompt.js');

      expect(loader.getSystemPromptAdditions()).toBe('');
    });
  });

  describe('reloadSkill', () => {
    it('should reload a skill by name and return true', async () => {
      writeFileSync(join(TMP_DIR, 'reload-me.js'), `export default async function() {
        return {
          manifest: { name: 'reload-me', version: '1.0.0', description: 'V1' },
          tools: [],
        };
      }`, 'utf-8');

      await loader.loadSkillFile('reload-me.js');
      expect(loader.getSkill('reload-me')).toBeDefined();

      const success = await loader.reloadSkill('reload-me');

      expect(success).toBe(true);
      expect(loader.getSkill('reload-me')).toBeDefined();
    });

    it('should return false when skill not found', async () => {
      writeFileSync(join(TMP_DIR, 'other.js'), makeSkillModule(), 'utf-8');

      const success = await loader.reloadSkill('nonexistent');

      expect(success).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      writeFileSync(join(TMP_DIR, 'broken.js'), 'throw new Error("broken");', 'utf-8');

      const success = await loader.reloadSkill('broken');

      expect(success).toBe(false);
    });
  });

  describe('removeSkill', () => {
    it('should remove a skill by name', async () => {
      writeFileSync(join(TMP_DIR, 'remove-me.js'), makeSkillModule({ manifest: { name: 'remove-me', version: '1.0.0', description: '' } } as any), 'utf-8');

      await loader.loadSkillFile('remove-me.js');
      expect(loader.getSkill('remove-me')).toBeDefined();

      const removed = loader.removeSkill('remove-me');

      expect(removed).toBe(true);
      expect(loader.getSkill('remove-me')).toBeUndefined();
    });

    it('should return false when skill does not exist', () => {
      expect(loader.removeSkill('nonexistent')).toBe(false);
    });
  });

  describe('findSkillFile', () => {
    it('should find the file path for a skill by name', async () => {
      writeFileSync(join(TMP_DIR, 'findme.js'), makeSkillModule({ manifest: { name: 'findme', version: '1.0.0', description: '' } } as any), 'utf-8');

      const result = await loader.findSkillFile('findme');

      expect(result).toBe(join(TMP_DIR, 'findme.js'));
    });

    it('should return null when skill not found', async () => {
      writeFileSync(join(TMP_DIR, 'other.js'), makeSkillModule(), 'utf-8');

      const result = await loader.findSkillFile('nope');

      expect(result).toBeNull();
    });

    it('should return null when skills directory does not exist', async () => {
      const missingLoader = new SkillLoader(join(TMP_DIR, 'missing'));

      const result = await missingLoader.findSkillFile('anything');

      expect(result).toBeNull();
    });

    it('should skip invalid files without throwing', async () => {
      writeFileSync(join(TMP_DIR, 'invalid.js'), 'export default null;', 'utf-8');
      writeFileSync(join(TMP_DIR, 'valid.js'), makeSkillModule({ manifest: { name: 'valid', version: '1.0.0', description: '' } } as any), 'utf-8');

      const result = await loader.findSkillFile('valid');

      expect(result).toBe(join(TMP_DIR, 'valid.js'));
    });
  });
});
