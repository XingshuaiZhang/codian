/**
 * VaultFileAdapter - Wrapper around Obsidian Vault API for file operations.
 *
 * Provides a consistent interface for file operations using Obsidian's
 * vault adapter instead of Node's fs module.
 */

import * as fs from 'fs/promises';
import type { App } from 'obsidian';
import * as path from 'path';

export class VaultFileAdapter {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private app: App) {}

  async exists(path: string): Promise<boolean> {
    return this.app.vault.adapter.exists(path);
  }

  async read(path: string): Promise<string> {
    return this.app.vault.adapter.read(path);
  }

  async readFirstLine(filePath: string): Promise<string> {
    const absolutePath = this.getAbsolutePath(filePath);
    if (!absolutePath) {
      const content = await this.read(filePath);
      return content.split(/\r?\n/, 1)[0] ?? '';
    }

    let handle: fs.FileHandle | null = null;
    try {
      handle = await fs.open(absolutePath, 'r');
      const chunks: Buffer[] = [];
      const buffer = Buffer.alloc(4096);
      let keepReading = true;

      while (keepReading) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (bytesRead <= 0) {
          break;
        }

        const chunk = buffer.subarray(0, bytesRead);
        const newlineIndex = chunk.indexOf(0x0a);
        if (newlineIndex >= 0) {
          chunks.push(chunk.subarray(0, newlineIndex));
          keepReading = false;
          continue;
        }

        chunks.push(chunk);
        if (bytesRead < buffer.length) {
          keepReading = false;
        }
      }

      return Buffer.concat(chunks).toString('utf8').replace(/\r$/, '');
    } catch {
      const content = await this.read(filePath);
      return content.split(/\r?\n/, 1)[0] ?? '';
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  async write(path: string, content: string): Promise<void> {
    await this.ensureParentFolder(path);
    await this.app.vault.adapter.write(path, content);
  }

  async append(path: string, content: string): Promise<void> {
    await this.ensureParentFolder(path);
    this.writeQueue = this.writeQueue.then(async () => {
      if (await this.exists(path)) {
        const existing = await this.read(path);
        await this.app.vault.adapter.write(path, existing + content);
      } else {
        await this.app.vault.adapter.write(path, content);
      }
    }).catch(() => {
      // prevent queue from getting stuck
    });
    await this.writeQueue;
  }

  async delete(path: string): Promise<void> {
    if (await this.exists(path)) {
      await this.app.vault.adapter.remove(path);
    }
  }

  /** Fails silently if non-empty or missing. */
  async deleteFolder(path: string): Promise<void> {
    try {
      if (await this.exists(path)) {
        await this.app.vault.adapter.rmdir(path, false);
      }
    } catch {
      // Non-critical: directory may not be empty
    }
  }

  async listFiles(folder: string): Promise<string[]> {
    if (!(await this.exists(folder))) {
      return [];
    }
    const listing = await this.app.vault.adapter.list(folder);
    return listing.files;
  }

  /** List subfolders in a folder. Returns relative paths from the folder. */
  async listFolders(folder: string): Promise<string[]> {
    if (!(await this.exists(folder))) {
      return [];
    }
    const listing = await this.app.vault.adapter.list(folder);
    return listing.folders;
  }

  /** Recursively list all files in a folder and subfolders. */
  async listFilesRecursive(folder: string): Promise<string[]> {
    const allFiles: string[] = [];

    const processFolder = async (currentFolder: string) => {
      if (!(await this.exists(currentFolder))) return;

      const listing = await this.app.vault.adapter.list(currentFolder);
      allFiles.push(...listing.files);

      for (const subfolder of listing.folders) {
        await processFolder(subfolder);
      }
    };

    await processFolder(folder);
    return allFiles;
  }

  private async ensureParentFolder(filePath: string): Promise<void> {
    const folder = filePath.substring(0, filePath.lastIndexOf('/'));
    if (folder && !(await this.exists(folder))) {
      await this.ensureFolder(folder);
    }
  }

  /** Ensure a folder exists, creating it and parent folders if needed. */
  async ensureFolder(path: string): Promise<void> {
    if (await this.exists(path)) return;

    // Create parent folders recursively
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  /** Rename/move a file. */
  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.app.vault.adapter.rename(oldPath, newPath);
  }

  async stat(path: string): Promise<{ mtime: number; size: number } | null> {
    try {
      const stat = await this.app.vault.adapter.stat(path);
      if (!stat) return null;
      return { mtime: stat.mtime, size: stat.size };
    } catch {
      return null;
    }
  }

  private getAbsolutePath(filePath: string): string | null {
    const adapter = this.app.vault.adapter as { basePath?: string };
    if (typeof adapter.basePath !== 'string' || adapter.basePath.length === 0) {
      return null;
    }

    return path.join(adapter.basePath, ...filePath.split('/'));
  }
}
