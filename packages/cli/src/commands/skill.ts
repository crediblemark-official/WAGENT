import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import color from 'picocolors';
import { SkillLoader } from '@wagent/core';

const SKILLS_DIR = join(process.cwd(), 'skills');

export async function listSkills(): Promise<void> {
  const loader = new SkillLoader(SKILLS_DIR);
  await loader.loadAll();
  const skills = loader.getLoadedSkills();

  console.log('');
  console.log(color.bold('🧩 WAGENT Skills'));
  console.log('──────────────────────────');

  if (skills.length === 0) {
    console.log(color.dim('  Tidak ada skill terinstall.'));
    console.log(color.dim(`  Letakkan file .js skill di: ${SKILLS_DIR}`));
    console.log(color.dim('  Atau install: wagent skill install <path>'));
    console.log('');
    return;
  }

  for (const skill of skills) {
    console.log(`  ${color.cyan(skill.manifest.name)} ${color.dim('v' + skill.manifest.version)}`);
    console.log(`    ${skill.manifest.description}`);
    if (skill.manifest.author) console.log(`    Author: ${skill.manifest.author}`);
    console.log(`    Tools: ${skill.tools.map(t => color.green(t.name)).join(', ')}`);
    console.log('');
  }

  console.log(color.dim(`  Total: ${skills.length} skill, ${loader.getTools().length} tools`));
  console.log('');
}

export async function installSkill(skillPath: string): Promise<void> {
  const resolvedPath = join(process.cwd(), skillPath);
  if (!existsSync(resolvedPath)) {
    console.log(color.red(`✗ File tidak ditemukan: ${resolvedPath}`));
    return;
  }

  if (!existsSync(SKILLS_DIR)) {
    mkdirSync(SKILLS_DIR, { recursive: true });
  }

  const filename = `skill-${Date.now()}.js`;
  const destPath = join(SKILLS_DIR, filename);

  const content = readFileSync(resolvedPath, 'utf-8');
  writeFileSync(destPath, content);

  const loader = new SkillLoader(SKILLS_DIR);
  const skill = await loader.loadSkillFile(filename);

  if (skill) {
    console.log(color.green(`\n✓ Skill "${skill.manifest.name}" v${skill.manifest.version} berhasil diinstall!`));
    console.log(color.cyan(`  File: ${destPath}`));
    console.log(color.dim('  Restart WAGENT untuk mengaktifkan skill ini.'));
    console.log('');
  } else {
    try { unlinkSync(destPath); } catch (err: any) {
      console.log(color.dim(`  (cleanup: ${err.message})`));
    }
    console.log(color.red('✗ Gagal menginstall skill. Perbaiki error dan coba lagi.'));
    console.log('');
  }
}

export async function removeSkill(name: string): Promise<void> {
  if (!existsSync(SKILLS_DIR)) {
    console.log(color.red('✗ Tidak ada skill terinstall.'));
    return;
  }

  const loader = new SkillLoader(SKILLS_DIR);
  const filePath = await loader.findSkillFile(name);

  if (filePath && existsSync(filePath)) {
    unlinkSync(filePath);
    console.log(color.green(`\n✓ Skill "${name}" berhasil dihapus.`));
    console.log(color.dim(`  File: ${filePath}`));
  } else {
    console.log(color.red(`✗ Skill "${name}" tidak ditemukan.`));
  }
  console.log('');
}
