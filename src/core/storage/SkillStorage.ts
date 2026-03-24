import { parsedToSlashCommand, parseSlashCommandContent, serializeCommand } from '../../utils/slashCommand';
import type { SlashCommand } from '../types';
import type { VaultFileAdapter } from './VaultFileAdapter';

export const SKILLS_PATH = '.agents/skills';

export class SkillStorage {
  constructor(private adapter: VaultFileAdapter) {}

  async loadAll(): Promise<SlashCommand[]> {
    const skills: SlashCommand[] = [];
    const loadedNames = new Set<string>();
    const seenPaths = new Set<string>();

    try {
      const folders = await this.adapter.listFolders(SKILLS_PATH);

      for (const folder of folders) {
        const skillName = folder.split('/').pop()!;
        if (loadedNames.has(skillName)) continue;
        const skillPath = `${folder}/SKILL.md`;
        if (seenPaths.has(skillPath)) continue;
        seenPaths.add(skillPath);

        try {
          if (!(await this.adapter.exists(skillPath))) continue;

          const content = await this.adapter.read(skillPath);
          const parsed = parseSlashCommandContent(content);

          skills.push(parsedToSlashCommand(parsed, {
            id: `skill-${skillName}`,
            name: skillName,
            source: 'user',
          }));
          loadedNames.add(skillName);
        } catch {
          // Non-critical: skip malformed skill files
        }
      }
    } catch {
      // Directory may not exist yet
    }

    return skills;
  }

  async save(skill: SlashCommand): Promise<void> {
    const dirPath = `${SKILLS_PATH}/${skill.name}`;
    const filePath = `${dirPath}/SKILL.md`;

    await this.adapter.ensureFolder(dirPath);
    await this.adapter.write(filePath, serializeCommand(skill));
  }

  async delete(skillId: string): Promise<void> {
    const name = skillId.replace(/^skill-/, '');
    const dirPath = `${SKILLS_PATH}/${name}`;
    const filePath = `${dirPath}/SKILL.md`;
    try {
      await this.adapter.delete(filePath);
    } catch {
      // Ignore missing files
    }
    try {
      await this.adapter.deleteFolder(dirPath);
    } catch {
      // Ignore missing folders
    }
  }
}
