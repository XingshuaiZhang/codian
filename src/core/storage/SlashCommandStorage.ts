import { parsedToSlashCommand, parseSlashCommandContent, serializeCommand } from '../../utils/slashCommand';
import type { SlashCommand } from '../types';
import type { VaultFileAdapter } from './VaultFileAdapter';

export const COMMANDS_PATH = '.codian/obsidian/commands';

export class SlashCommandStorage {
  constructor(private adapter: VaultFileAdapter) {}

  async loadAll(): Promise<SlashCommand[]> {
    const commands: SlashCommand[] = [];
    const seenIds = new Set<string>();
    const seenPaths = new Set<string>();

    try {
      const files = await this.adapter.listFilesRecursive(COMMANDS_PATH);

      for (const filePath of files) {
        if (!filePath.endsWith('.md')) continue;
        if (seenPaths.has(filePath)) continue;
        seenPaths.add(filePath);

        try {
          const command = await this.loadFromFile(filePath);
          if (command && !seenIds.has(command.id)) {
            commands.push(command);
            seenIds.add(command.id);
          }
        } catch {
          // Non-critical: skip malformed command files
        }
      }
    } catch {
      // Non-critical: directory may not exist yet
    }

    return commands;
  }

  private async loadFromFile(filePath: string): Promise<SlashCommand | null> {
    const content = await this.adapter.read(filePath);
    return this.parseFile(content, filePath);
  }

  async save(command: SlashCommand): Promise<void> {
    const filePath = this.getFilePath(command);
    await this.adapter.write(filePath, serializeCommand(command));
  }

  async delete(commandId: string): Promise<void> {
    const deletedPaths = new Set<string>();

    let files: string[] = [];
    try {
      files = await this.adapter.listFilesRecursive(COMMANDS_PATH);
    } catch {
      return;
    }

    for (const filePath of files) {
      if (!filePath.endsWith('.md')) continue;

      const id = this.filePathToId(filePath);
      if (id === commandId && !deletedPaths.has(filePath)) {
        await this.adapter.delete(filePath);
        deletedPaths.add(filePath);
      }
    }
  }

  getFilePath(command: SlashCommand): string {
    const safeName = command.name.replace(/[^a-zA-Z0-9_/-]/g, '-');
    return `${COMMANDS_PATH}/${safeName}.md`;
  }

  private parseFile(content: string, filePath: string): SlashCommand {
    const parsed = parseSlashCommandContent(content);
    return parsedToSlashCommand(parsed, {
      id: this.filePathToId(filePath),
      name: this.filePathToName(filePath),
    });
  }

  private filePathToId(filePath: string): string {
    // Encoding: escape `-` as `-_`, then replace `/` with `--`
    // This is unambiguous and reversible:
    //   a/b.md   -> cmd-a--b
    //   a-b.md   -> cmd-a-_b
    //   a--b.md  -> cmd-a-_-_b
    //   a/b-c.md -> cmd-a--b-_c
    const relativePath = this.getRelativeCommandPath(filePath);
    const escaped = relativePath
      .replace(/-/g, '-_')   // Escape dashes first
      .replace(/\//g, '--'); // Then encode slashes
    return `cmd-${escaped}`;
  }

  private filePathToName(filePath: string): string {
    return this.getRelativeCommandPath(filePath);
  }

  private getRelativeCommandPath(filePath: string): string {
    return filePath
      .replace(`${COMMANDS_PATH}/`, '')
      .replace(/\.md$/, '');
  }
}
