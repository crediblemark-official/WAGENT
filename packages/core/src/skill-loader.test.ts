import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmdirSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SkillLoader } from './skill-loader.js';

// ── Helpers ────────────────────────────────────────────────────

function tempDir(): { path: string; cleanup: () => void } {
  const p = mkdtempSync(join(tmpdir(), 'skill-test-'));
  return {
    path: p,
    cleanup: () => { try { rmdirSync(p, { recursive: true }); } catch { /* */ } },
  };
}

function writeSkill(dir: string, name: string, content: string): string {
  const fp = join(dir, name);
  writeFileSync(fp, content, 'utf-8');
  return fp;
}

function createGreetingSkill(): string {
  return `
export default async function() {
  return {
    manifest: {
      name: 'greeting-skill',
      version: '1.0.0',
      description: 'Skill untuk menyapa customer',
      systemPromptAdditions: 'Gunakan sapaan hangat kepada customer'
    },
    tools: [
      {
        name: 'say_hello',
        description: 'Mengucapkan halo',
        parameters: { type: 'object', properties: {} },
        handler: async () => 'Halo!'
      }
    ]
  };
}
`;
}

function createMultiToolSkill(): string {
  return `
export default async function() {
  return {
    manifest: {
      name: 'multi-tool-skill',
      version: '2.0.0',
      description: 'Skill dengan banyak tools'
    },
    tools: [
      {
        name: 'tool_one',
        description: 'Tool pertama',
        parameters: { type: 'object', properties: {} },
        handler: async () => 'One'
      },
      {
        name: 'tool_two',
        description: 'Tool kedua',
        parameters: { type: 'object', properties: {} },
        handler: async () => 'Two'
      }
    ]
  };
}
`;
}

function createNoDefaultExport(): string {
  return `
export const something = 'not a function';
`;
}

function createInvalidSkill(): string {
  return `
export default async function() {
  return {
    manifest: {
      name: '',  // empty name
      version: '1.0.0',
    },
    tools: []
  };
}
`;
}

// ── Tests ──────────────────────────────────────────────────────

describe('SkillLoader — initialization', () => {
  it('should use default skills directory', () => {
    const loader = new SkillLoader();
    expect(loader.getSkillsDir()).toContain('skills');
  });

  it('should use custom skills directory', () => {
    const loader = new SkillLoader('/custom/skills');
    expect(loader.getSkillsDir()).toBe('/custom/skills');
  });

  it('should start with no skills loaded', () => {
    const loader = new SkillLoader();
    expect(loader.getLoadedSkills()).toEqual([]);
    expect(loader.getTools()).toEqual([]);
    expect(loader.getSystemPromptAdditions()).toBe('');
  });
});

describe('SkillLoader — loadAll with directory', () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = tempDir();
    dir = tmp.path;
    cleanup = tmp.cleanup;
    mkdirSync(join(dir, 'skills'));
  });

  afterEach(() => cleanup());

  it('should load skill files from directory', async () => {
    writeSkill(join(dir, 'skills'), 'greeting.mjs', createGreetingSkill());
    const loader = new SkillLoader(join(dir, 'skills'));
    await loader.loadAll();

    const skills = loader.getLoadedSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].manifest.name).toBe('greeting-skill');
    expect(skills[0].manifest.version).toBe('1.0.0');
    expect(skills[0].manifest.description).toBe('Skill untuk menyapa customer');
  });

  it('should load multiple skill files', async () => {
    writeSkill(join(dir, 'skills'), 'greeting.mjs', createGreetingSkill());
    writeSkill(join(dir, 'skills'), 'multi.mjs', createMultiToolSkill());
    const loader = new SkillLoader(join(dir, 'skills'));
    await loader.loadAll();

    expect(loader.getLoadedSkills()).toHaveLength(2);
  });

  it('should combine tools from all loaded skills', async () => {
    writeSkill(join(dir, 'skills'), 'greeting.mjs', createGreetingSkill());
    writeSkill(join(dir, 'skills'), 'multi.mjs', createMultiToolSkill());
    const loader = new SkillLoader(join(dir, 'skills'));
    await loader.loadAll();

    const tools = loader.getTools();
    expect(tools).toHaveLength(3); // 1 from greeting + 2 from multi
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('say_hello');
    expect(toolNames).toContain('tool_one');
    expect(toolNames).toContain('tool_two');
  });

  it('should collect system prompt additions', async () => {
    writeSkill(join(dir, 'skills'), 'greeting.mjs', createGreetingSkill());
    writeSkill(join(dir, 'skills'), 'multi.mjs', createMultiToolSkill()); // no systemPromptAdditions
    const loader = new SkillLoader(join(dir, 'skills'));
    await loader.loadAll();

    const additions = loader.getSystemPromptAdditions();
    expect(additions).toContain('Gunakan sapaan hangat');
    // Only greeting skill has additions, no stray newlines from multi skill
    expect(additions).not.toContain('undefined');
  });

  it('should skip non-skill files (.txt, .json)', async () => {
    writeSkill(join(dir, 'skills'), 'greeting.mjs', createGreetingSkill());
    writeSkill(join(dir, 'skills'), 'readme.txt', 'not a skill');
    writeSkill(join(dir, 'skills'), 'config.json', '{}');
    const loader = new SkillLoader(join(dir, 'skills'));
    await loader.loadAll();

    // Only .mjs file should be loaded
    expect(loader.getLoadedSkills()).toHaveLength(1);
  });

  it('should load .js extension skill files', async () => {
    writeSkill(join(dir, 'skills'), 'greeting.js', createGreetingSkill());
    const loader = new SkillLoader(join(dir, 'skills'));
    await loader.loadAll();

    expect(loader.getLoadedSkills()).toHaveLength(1);
    expect(loader.getLoadedSkills()[0].manifest.name).toBe('greeting-skill');
  });

  it('should handle non-existent skills directory', async () => {
    const loader = new SkillLoader(join(dir, 'nonexistent'));
    // Should not throw, just log a warning
    await expect(loader.loadAll()).resolves.not.toThrow();
    expect(loader.getLoadedSkills()).toHaveLength(0);
  });

  it('should skip files without default export', async () => {
    writeSkill(join(dir, 'skills'), 'bad.mjs', createNoDefaultExport());
    const loader = new SkillLoader(join(dir, 'skills'));
    await loader.loadAll(); // Should not throw
    expect(loader.getLoadedSkills()).toHaveLength(0);
  });
});

describe('SkillLoader — loadSkillFile', () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = tempDir();
    dir = tmp.path;
    cleanup = tmp.cleanup;
    mkdirSync(join(dir, 'skills'));
  });

  afterEach(() => cleanup());

  it('should load a single skill file', async () => {
    writeSkill(join(dir, 'skills'), 'greeting.mjs', createGreetingSkill());
    const loader = new SkillLoader(join(dir, 'skills'));
    const result = await loader.loadSkillFile('greeting.mjs');
    expect(result).not.toBeNull();
    expect(result!.manifest.name).toBe('greeting-skill');
  });

  it('should return null for file without default export', async () => {
    writeSkill(join(dir, 'skills'), 'bad.mjs', createNoDefaultExport());
    const loader = new SkillLoader(join(dir, 'skills'));
    const result = await loader.loadSkillFile('bad.mjs');
    expect(result).toBeNull();
  });

  it('should return null for non-existent file', async () => {
    const loader = new SkillLoader(join(dir, 'skills'));
    const result = await loader.loadSkillFile('nonexistent.mjs');
    expect(result).toBeNull();
  });

  it('should get a loaded skill by name', async () => {
    writeSkill(join(dir, 'skills'), 'greeting.mjs', createGreetingSkill());
    const loader = new SkillLoader(join(dir, 'skills'));
    await loader.loadSkillFile('greeting.mjs');

    const skill = loader.getSkill('greeting-skill');
    expect(skill).toBeDefined();
    expect(skill!.manifest.version).toBe('1.0.0');
  });

  it('should return undefined for non-existent skill', () => {
    const loader = new SkillLoader();
    expect(loader.getSkill('nonexistent')).toBeUndefined();
  });
});

describe('SkillLoader — remove and reload', () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = tempDir();
    dir = tmp.path;
    cleanup = tmp.cleanup;
    mkdirSync(join(dir, 'skills'));
  });

  afterEach(() => cleanup());

  it('should remove a loaded skill', async () => {
    writeSkill(join(dir, 'skills'), 'greeting.mjs', createGreetingSkill());
    const loader = new SkillLoader(join(dir, 'skills'));
    await loader.loadAll();
    expect(loader.getLoadedSkills()).toHaveLength(1);

    const removed = loader.removeSkill('greeting-skill');
    expect(removed).toBe(true);
    expect(loader.getLoadedSkills()).toHaveLength(0);
  });

  it('should return false when removing non-existent skill', () => {
    const loader = new SkillLoader();
    const removed = loader.removeSkill('nonexistent');
    expect(removed).toBe(false);
  });

  it('should reload a skill', async () => {
    writeSkill(join(dir, 'skills'), 'greeting.mjs', createGreetingSkill());
    const loader = new SkillLoader(join(dir, 'skills'));
    await loader.loadAll();
    expect(loader.getLoadedSkills()).toHaveLength(1);

    // Reload should find and re-import the skill
    const reloaded = await loader.reloadSkill('greeting-skill');
    expect(reloaded).toBe(true);
    expect(loader.getLoadedSkills()).toHaveLength(1);
  });

  it('should return false when reloading non-existent skill', async () => {
    const loader = new SkillLoader(join(dir, 'skills'));
    const reloaded = await loader.reloadSkill('nonexistent');
    expect(reloaded).toBe(false);
  });
});

describe('SkillLoader — validation', () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = tempDir();
    dir = tmp.path;
    cleanup = tmp.cleanup;
    mkdirSync(join(dir, 'skills'));
  });

  afterEach(() => cleanup());

  it('should reject skill with empty name', async () => {
    writeSkill(join(dir, 'skills'), 'invalid.mjs', createInvalidSkill());
    const loader = new SkillLoader(join(dir, 'skills'));
    const result = await loader.loadSkillFile('invalid.mjs');
    expect(result).toBeNull(); // validation fails, caught by try/catch
  });

  it('should reject skill without version', async () => {
    writeSkill(join(dir, 'skills'), 'noversion.mjs', `
export default async function() {
  return {
    manifest: {
      name: 'no-version-skill',
      // no version
    },
    tools: []
  };
}
`);
    const loader = new SkillLoader(join(dir, 'skills'));
    const result = await loader.loadSkillFile('noversion.mjs');
    expect(result).toBeNull(); // validation fails
  });

  it('should reject skill without tools array', async () => {
    writeSkill(join(dir, 'skills'), 'notools.mjs', `
export default async function() {
  return {
    manifest: {
      name: 'no-tools-skill',
      version: '1.0.0',
    },
    // no tools
  };
}
`);
    const loader = new SkillLoader(join(dir, 'skills'));
    const result = await loader.loadSkillFile('notools.mjs');
    expect(result).toBeNull(); // validation fails
  });
});

describe('SkillLoader — findSkillFile', () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = tempDir();
    dir = tmp.path;
    cleanup = tmp.cleanup;
    mkdirSync(join(dir, 'skills'));
  });

  afterEach(() => cleanup());

  it('should find skill file by name', async () => {
    writeSkill(join(dir, 'skills'), 'greeting.mjs', createGreetingSkill());
    const loader = new SkillLoader(join(dir, 'skills'));
    const found = await loader.findSkillFile('greeting-skill');
    expect(found).not.toBeNull();
    expect(found).toContain('greeting.mjs');
  });

  it('should return null for non-existent skill', async () => {
    const loader = new SkillLoader(join(dir, 'skills'));
    const found = await loader.findSkillFile('nonexistent');
    expect(found).toBeNull();
  });

  it('should return null when skills dir does not exist', async () => {
    const loader = new SkillLoader(join(dir, 'nonexistent'));
    const found = await loader.findSkillFile('anything');
    expect(found).toBeNull();
  });
});
