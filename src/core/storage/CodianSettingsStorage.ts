/**
 * CodianSettingsStorage - Handles codian-settings.json read/write.
 *
 * Manages the .codian/obsidian/settings.json file for plugin-specific settings.
 * These settings are NOT shared with the Codex CLI.
 *
 * Includes:
 * - User preferences (userName)
 * - Security (blocklist, permission mode)
 * - Model & thinking settings
 * - Content settings (tags, media, prompts)
 * - Environment (string format, snippets)
 * - UI settings (keyboard navigation)
 * - CLI paths
 * - State (merged from data.json)
 */

import type { CodexModel, CodianSettings, PlatformBlockedCommands } from '../types';
import { DEFAULT_SETTINGS, getDefaultBlockedCommands } from '../types';
import type { VaultFileAdapter } from './VaultFileAdapter';

/** Path to Codian settings file relative to vault root. */
export const CODIAN_SETTINGS_PATH = '.codian/obsidian/settings.json';

/** Fields that are loaded separately (slash commands from .codian/obsidian/commands/). */
type SeparatelyLoadedFields = 'slashCommands';

/** Settings stored in `.codian/obsidian/settings.json`. */
export type StoredCodianSettings = Omit<CodianSettings, SeparatelyLoadedFields>;

function normalizeCommandList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function normalizeBlockedCommands(value: unknown): PlatformBlockedCommands {
  const defaults = getDefaultBlockedCommands();

  // Migrate old string[] format to new platform-keyed structure
  if (Array.isArray(value)) {
    return {
      unix: normalizeCommandList(value, defaults.unix),
      windows: [...defaults.windows],
    };
  }

  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const candidate = value as Record<string, unknown>;
  return {
    unix: normalizeCommandList(candidate.unix, defaults.unix),
    windows: normalizeCommandList(candidate.windows, defaults.windows),
  };
}

function normalizeHostnameCliPaths(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === 'string' && val.trim()) {
      result[key] = val.trim();
    }
  }
  return result;
}

export class CodianSettingsStorage {
  constructor(private adapter: VaultFileAdapter) { }

  /**
   * Load Codian settings from `.codian/obsidian/settings.json`.
   * Returns default settings if file doesn't exist.
   * Throws if file exists but cannot be read or parsed.
   */
  async load(): Promise<StoredCodianSettings> {
    if (!(await this.adapter.exists(CODIAN_SETTINGS_PATH))) {
      return this.getDefaults();
    }

    const content = await this.adapter.read(CODIAN_SETTINGS_PATH);
    const stored = JSON.parse(content) as Record<string, unknown>;
    const { activeConversationId: _activeConversationId, show1MModel: _show1MModel, ...storedWithoutLegacy } = stored;

    // Remove legacy show1MModel from persisted file (replaced by enableOpus1M/enableSonnet1M)
    if ('show1MModel' in stored) {
      await this.adapter.write(CODIAN_SETTINGS_PATH, JSON.stringify(storedWithoutLegacy, null, 2));
    }

    const blockedCommands = normalizeBlockedCommands(stored.blockedCommands);
    const hostnameCliPaths = normalizeHostnameCliPaths(stored.codexCliPathsByHost);
    const cliPath = typeof stored.codexCliPath === 'string' ? stored.codexCliPath : '';

    return {
      ...this.getDefaults(),
      ...storedWithoutLegacy,
      blockedCommands,
      codexCliPath: cliPath,
      codexCliPathsByHost: hostnameCliPaths,
    } as StoredCodianSettings;
  }

  async save(settings: StoredCodianSettings): Promise<void> {
    const content = JSON.stringify(settings, null, 2);
    await this.adapter.write(CODIAN_SETTINGS_PATH, content);
  }

  async exists(): Promise<boolean> {
    return this.adapter.exists(CODIAN_SETTINGS_PATH);
  }

  async update(updates: Partial<StoredCodianSettings>): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, ...updates });
  }

  /**
   * Read legacy activeConversationId from codian-settings.json, if present.
   * Used only for one-time migration to tabManagerState.
   */
  async getLegacyActiveConversationId(): Promise<string | null> {
    if (!(await this.adapter.exists(CODIAN_SETTINGS_PATH))) {
      return null;
    }

    const content = await this.adapter.read(CODIAN_SETTINGS_PATH);
    const stored = JSON.parse(content) as Record<string, unknown>;
    const value = stored.activeConversationId;

    if (typeof value === 'string') {
      return value;
    }

    return null;
  }

  /**
   * Remove legacy activeConversationId from codian-settings.json.
   */
  async clearLegacyActiveConversationId(): Promise<void> {
    if (!(await this.adapter.exists(CODIAN_SETTINGS_PATH))) {
      return;
    }

    const content = await this.adapter.read(CODIAN_SETTINGS_PATH);
    const stored = JSON.parse(content) as Record<string, unknown>;

    if (!('activeConversationId' in stored)) {
      return;
    }

    delete stored.activeConversationId;
    const nextContent = JSON.stringify(stored, null, 2);
    await this.adapter.write(CODIAN_SETTINGS_PATH, nextContent);
  }

  async setLastModel(model: CodexModel, isCustom: boolean): Promise<void> {
    if (isCustom) {
      await this.update({ lastCustomModel: model });
    } else {
      await this.update({ lastPresetModel: model });
    }
  }

  async setLastEnvHash(hash: string): Promise<void> {
    await this.update({ lastEnvHash: hash });
  }

  /**
   * Get default settings (excluding separately loaded fields).
   */
  private getDefaults(): StoredCodianSettings {
    const {
      slashCommands: _,
      ...defaults
    } = DEFAULT_SETTINGS;

    return defaults;
  }
}
