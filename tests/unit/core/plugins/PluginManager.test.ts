import { PluginManager } from '@/core/plugins/PluginManager';

function createMockCCSettingsStorage() {
  return {
    getEnabledPlugins: jest.fn().mockResolvedValue({}),
    setPluginEnabled: jest.fn().mockResolvedValue(undefined),
  } as any;
}

describe('PluginManager', () => {
  const vaultPath = '/Users/testuser/Documents/vault';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps plugins disabled as an empty placeholder manager', async () => {
    const ccSettings = createMockCCSettingsStorage();
    const manager = new PluginManager(vaultPath, ccSettings);

    await manager.loadPlugins();

    expect(manager.getPlugins()).toEqual([]);
    expect(manager.hasPlugins()).toBe(false);
    expect(manager.hasEnabledPlugins()).toBe(false);
    expect(manager.getEnabledCount()).toBe(0);
    expect(manager.getPluginsKey()).toBe('');
  });

  it('treats enable and disable operations as no-ops', async () => {
    const ccSettings = createMockCCSettingsStorage();
    const manager = new PluginManager(vaultPath, ccSettings);

    await manager.loadPlugins();
    await manager.togglePlugin('test-plugin@marketplace');
    await manager.enablePlugin('test-plugin@marketplace');
    await manager.disablePlugin('test-plugin@marketplace');

    expect(manager.getPlugins()).toEqual([]);
    expect(ccSettings.setPluginEnabled).not.toHaveBeenCalled();
  });
});
