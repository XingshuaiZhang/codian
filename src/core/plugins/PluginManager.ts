import type { CCSettingsStorage } from '../storage/CCSettingsStorage';
import type { CodianPlugin } from '../types';

export class PluginManager {
  private plugins: CodianPlugin[] = [];

  constructor(_vaultPath: string, _ccSettingsStorage: CCSettingsStorage) {}

  async loadPlugins(): Promise<void> {
    this.plugins = [];
  }

  getPlugins(): CodianPlugin[] {
    return [];
  }

  hasPlugins(): boolean {
    return false;
  }

  hasEnabledPlugins(): boolean {
    return false;
  }

  getEnabledCount(): number {
    return 0;
  }

  getPluginsKey(): string {
    return '';
  }

  async togglePlugin(_pluginId: string): Promise<void> {}

  async enablePlugin(_pluginId: string): Promise<void> {}

  async disablePlugin(_pluginId: string): Promise<void> {}
}
