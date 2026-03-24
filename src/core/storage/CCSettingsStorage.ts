/**
 * RuntimeSettingsStorage - Handles plugin-owned runtime settings read/write.
 *
 * Manages the .codian/obsidian/runtime-settings.json file for runtime interoperability.
 *
 * Only runtime-compatible fields are stored here:
 * - permissions (allow/deny/ask)
 * - model (optional override)
 * - env (optional environment variables)
 *
 * Codian-specific settings go in codian-settings.json.
 */

import type {
  CCPermissions,
  CCSettings,
  LegacyPermission,
  PermissionRule,
} from '../types';
import {
  DEFAULT_CC_PERMISSIONS,
  DEFAULT_CC_SETTINGS,
  legacyPermissionsToCCPermissions,
} from '../types';
import { CODIAN_ONLY_FIELDS } from './migrationConstants';
import type { VaultFileAdapter } from './VaultFileAdapter';

/** Path to runtime settings file relative to vault root. */
export const CC_SETTINGS_PATH = '.codian/obsidian/runtime-settings.json';

/** Schema URL for plugin-owned runtime settings. */
const CC_SETTINGS_SCHEMA = 'https://openai.com/codex/runtime-settings.schema.json';

function hasCodianOnlyFields(data: Record<string, unknown>): boolean {
  return Object.keys(data).some(key => CODIAN_ONLY_FIELDS.has(key));
}

/**
 * Check if a settings object uses the legacy Codian permissions format.
 * Legacy format: permissions is an array of objects with toolName/pattern.
 */
export function isLegacyPermissionsFormat(data: unknown): data is { permissions: LegacyPermission[] } {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.permissions)) return false;
  if (obj.permissions.length === 0) return false;

  // Check if first item has legacy structure
  const first = obj.permissions[0];
  return (
    typeof first === 'object' &&
    first !== null &&
    'toolName' in first &&
    'pattern' in first
  );
}

function normalizeRuleList(value: unknown): PermissionRule[] {
  if (!Array.isArray(value)) return [];
  return value.filter((r): r is string => typeof r === 'string') as PermissionRule[];
}

function normalizePermissions(permissions: unknown): CCPermissions {
  if (!permissions || typeof permissions !== 'object') {
    return { ...DEFAULT_CC_PERMISSIONS };
  }

  const p = permissions as Record<string, unknown>;
  return {
    allow: normalizeRuleList(p.allow),
    deny: normalizeRuleList(p.deny),
    ask: normalizeRuleList(p.ask),
    defaultMode: typeof p.defaultMode === 'string' ? p.defaultMode as CCPermissions['defaultMode'] : undefined,
    additionalDirectories: Array.isArray(p.additionalDirectories)
      ? p.additionalDirectories.filter((d): d is string => typeof d === 'string')
      : undefined,
  };
}

/**
 * Storage for runtime-compatible settings.
 *
 * Note: Permission update methods (addAllowRule, addDenyRule, etc.) use a
 * read-modify-write pattern. Concurrent calls may race and lose updates.
 * In practice this is fine since user interactions are sequential.
 */
export class CCSettingsStorage {
  constructor(private adapter: VaultFileAdapter) { }

  /**
   * Load runtime settings from `.codian/obsidian/runtime-settings.json`.
   * Returns default settings if file doesn't exist.
   * Throws if file exists but cannot be read or parsed.
   */
  async load(): Promise<CCSettings> {
    if (!(await this.adapter.exists(CC_SETTINGS_PATH))) {
      return { ...DEFAULT_CC_SETTINGS };
    }

    const content = await this.adapter.read(CC_SETTINGS_PATH);
    const stored = JSON.parse(content) as Record<string, unknown>;

    // Check for legacy format and migrate if needed
    if (isLegacyPermissionsFormat(stored)) {
      const legacyPerms = stored.permissions as LegacyPermission[];
      const ccPerms = legacyPermissionsToCCPermissions(legacyPerms);

      // Return migrated permissions but keep other CC fields
      return {
        $schema: CC_SETTINGS_SCHEMA,
        ...stored,
        permissions: ccPerms,
      };
    }

    return {
      $schema: CC_SETTINGS_SCHEMA,
      ...stored,
      permissions: normalizePermissions(stored.permissions),
    };
  }

  /**
   * Save runtime settings to `.codian/obsidian/runtime-settings.json`.
   *
   * @param stripCodianFields - If true, remove Codian-only fields (only during migration)
   */
  async save(settings: CCSettings, stripCodianFields: boolean = false): Promise<void> {
    // Load existing to preserve CC-specific fields we don't manage
    let existing: Record<string, unknown> = {};
    if (await this.adapter.exists(CC_SETTINGS_PATH)) {
      try {
        const content = await this.adapter.read(CC_SETTINGS_PATH);
        const parsed = JSON.parse(content) as Record<string, unknown>;

        // Only strip Codian-only fields during explicit migration
        if (stripCodianFields && (isLegacyPermissionsFormat(parsed) || hasCodianOnlyFields(parsed))) {
          existing = {};
          for (const [key, value] of Object.entries(parsed)) {
            if (!CODIAN_ONLY_FIELDS.has(key)) {
              existing[key] = value;
            }
          }
          // Also strip legacy permissions array format
          if (Array.isArray(existing.permissions)) {
            delete existing.permissions;
          }
        } else {
          existing = parsed;
        }
      } catch {
        // Parse error - start fresh with default settings
      }
    }

    // Merge: existing CC fields + our updates
    const merged: CCSettings = {
      ...existing,
      $schema: CC_SETTINGS_SCHEMA,
      permissions: settings.permissions ?? { ...DEFAULT_CC_PERMISSIONS },
    };

    if (settings.enabledPlugins !== undefined) {
      merged.enabledPlugins = settings.enabledPlugins;
    }

    const content = JSON.stringify(merged, null, 2);
    await this.adapter.write(CC_SETTINGS_PATH, content);
  }

  async exists(): Promise<boolean> {
    return this.adapter.exists(CC_SETTINGS_PATH);
  }

  async getPermissions(): Promise<CCPermissions> {
    const settings = await this.load();
    return settings.permissions ?? { ...DEFAULT_CC_PERMISSIONS };
  }

  async updatePermissions(permissions: CCPermissions): Promise<void> {
    const settings = await this.load();
    settings.permissions = permissions;
    await this.save(settings);
  }

  async addAllowRule(rule: PermissionRule): Promise<void> {
    const permissions = await this.getPermissions();
    if (!permissions.allow?.includes(rule)) {
      permissions.allow = [...(permissions.allow ?? []), rule];
      await this.updatePermissions(permissions);
    }
  }

  async addDenyRule(rule: PermissionRule): Promise<void> {
    const permissions = await this.getPermissions();
    if (!permissions.deny?.includes(rule)) {
      permissions.deny = [...(permissions.deny ?? []), rule];
      await this.updatePermissions(permissions);
    }
  }

  async addAskRule(rule: PermissionRule): Promise<void> {
    const permissions = await this.getPermissions();
    if (!permissions.ask?.includes(rule)) {
      permissions.ask = [...(permissions.ask ?? []), rule];
      await this.updatePermissions(permissions);
    }
  }

  /**
   * Remove a rule from all lists.
   */
  async removeRule(rule: PermissionRule): Promise<void> {
    const permissions = await this.getPermissions();
    permissions.allow = permissions.allow?.filter(r => r !== rule);
    permissions.deny = permissions.deny?.filter(r => r !== rule);
    permissions.ask = permissions.ask?.filter(r => r !== rule);
    await this.updatePermissions(permissions);
  }

  /**
   * Get enabled plugins map from CC settings.
   * Returns empty object if not set.
   */
  async getEnabledPlugins(): Promise<Record<string, boolean>> {
    const settings = await this.load();
    return settings.enabledPlugins ?? {};
  }

  /**
   * Set plugin enabled state.
   * Writes to `.codian/obsidian/runtime-settings.json`.
   *
   * @param pluginId - Full plugin ID (e.g., "plugin-name@source")
   * @param enabled - true to enable, false to disable
   */
  async setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const settings = await this.load();
    const enabledPlugins = settings.enabledPlugins ?? {};

    enabledPlugins[pluginId] = enabled;
    settings.enabledPlugins = enabledPlugins;

    await this.save(settings);
  }

  /**
   * Get list of plugin IDs that are explicitly enabled.
   * Used for PluginManager initialization.
   */
  async getExplicitlyEnabledPluginIds(): Promise<string[]> {
    const enabledPlugins = await this.getEnabledPlugins();
    return Object.entries(enabledPlugins)
      .filter(([, enabled]) => enabled)
      .map(([id]) => id);
  }

  /**
   * Check if a plugin is explicitly disabled.
   * Returns true only if the plugin is set to false.
   * Returns false if not set (inherits from global) or set to true.
   */
  async isPluginDisabled(pluginId: string): Promise<boolean> {
    const enabledPlugins = await this.getEnabledPlugins();
    return enabledPlugins[pluginId] === false;
  }
}
