import { Notice } from 'obsidian';
import * as os from 'os';

import { TOOL_TASK } from '@/core/tools/toolNames';
import { DEFAULT_SETTINGS, VIEW_TYPE_CODIAN } from '@/core/types';

// Mock fs for CodianService
jest.mock('fs');

// Now import the plugin after mocking
import CodianPlugin from '@/main';

describe('CodianPlugin', () => {
  let plugin: CodianPlugin;
  let mockApp: any;
  let mockManifest: any;
  const mockNotice = Notice as jest.Mock;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    mockApp = {
      vault: {
        adapter: {
          basePath: '/test/vault',
          exists: jest.fn().mockResolvedValue(false),
          read: jest.fn().mockResolvedValue(''),
          write: jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
          mkdir: jest.fn().mockResolvedValue(undefined),
          list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
          stat: jest.fn().mockResolvedValue(null),
          rename: jest.fn().mockResolvedValue(undefined),
        },
      },
      workspace: {
        getLeavesOfType: jest.fn().mockReturnValue([]),
        getRightLeaf: jest.fn().mockReturnValue({
          setViewState: jest.fn().mockResolvedValue(undefined),
        }),
        getLeaf: jest.fn().mockReturnValue({
          setViewState: jest.fn().mockResolvedValue(undefined),
        }),
        revealLeaf: jest.fn(),
      },
    };

    mockManifest = {
      id: 'codian',
      name: 'Codian',
      version: '0.1.0',
    };

    // Create plugin instance with mocked app
    plugin = new CodianPlugin(mockApp, mockManifest);
    (plugin.loadData as jest.Mock).mockResolvedValue({});
  });

  describe('onload', () => {
    it('should initialize settings with defaults', async () => {
      await plugin.onload();

      expect(plugin.settings).toBeDefined();
      expect(plugin.settings.enableBlocklist).toBe(DEFAULT_SETTINGS.enableBlocklist);
      expect(plugin.settings.blockedCommands).toEqual(DEFAULT_SETTINGS.blockedCommands);
    });

    // Note: With multi-tab, agentService is per-tab via TabManager, not on plugin

    it('should register the view', async () => {
      await plugin.onload();

      expect((plugin.registerView as jest.Mock)).toHaveBeenCalledWith(
        VIEW_TYPE_CODIAN,
        expect.any(Function)
      );
    });

    it('should add ribbon icon', async () => {
      await plugin.onload();

      expect((plugin.addRibbonIcon as jest.Mock)).toHaveBeenCalledWith(
        'codian-gpt',
        'Open Codian',
        expect.any(Function)
      );
    });

    it('should add command to open view', async () => {
      await plugin.onload();

      expect((plugin.addCommand as jest.Mock)).toHaveBeenCalledWith({
        id: 'open-view',
        name: 'Open chat view',
        callback: expect.any(Function),
      });
    });

    it('should migrate legacy cli path to hostname-based paths and clear old field', async () => {
      const legacyPath = '/legacy/codex';
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.codian/obsidian/settings.json';
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.codian/obsidian/settings.json') {
          return JSON.stringify({ codexCliPath: legacyPath });
        }
        return '';
      });

      await plugin.onload();

      const hostname = os.hostname();
      expect(plugin.settings.codexCliPathsByHost?.[hostname]).toBe(legacyPath);
      expect(plugin.settings.codexCliPathsByHost?.[hostname]).toBe(legacyPath);
      expect(plugin.settings.codexCliPath).toBe('');
      expect(plugin.settings.codexCliPath).toBe('');
      expect(mockApp.vault.adapter.write).toHaveBeenCalled();
      const settingsWrite = (mockApp.vault.adapter.write as jest.Mock).mock.calls.find(
        ([path]) => path === '.codian/obsidian/settings.json'
      );
      expect(settingsWrite).toBeDefined();
      const savedSettings = JSON.parse(settingsWrite[1]);
      expect(savedSettings.codexCliPathsByHost?.[hostname]).toBe(legacyPath);
      expect(savedSettings.codexCliPathsByHost?.[hostname]).toBe(legacyPath);
      expect(savedSettings.codexCliPath).toBe('');
      expect(savedSettings.codexCliPath).toBe('');
    });
  });

  describe('onunload', () => {
    // Note: With multi-tab, cleanup is handled per-tab via CodianView.onClose()
    it('should complete without error', async () => {
      await plugin.onload();

      expect(() => plugin.onunload()).not.toThrow();
    });
  });

  describe('activateView', () => {
    it('should reveal existing leaf if view already exists', async () => {
      const mockLeaf = { id: 'existing-leaf' };
      mockApp.workspace.getLeavesOfType.mockReturnValue([mockLeaf]);

      await plugin.onload();
      await plugin.activateView();

      expect(mockApp.workspace.revealLeaf).toHaveBeenCalledWith(mockLeaf);
    });

    it('should create new leaf in right sidebar if view does not exist', async () => {
      const mockRightLeaf = {
        setViewState: jest.fn().mockResolvedValue(undefined),
      };
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);
      mockApp.workspace.getRightLeaf.mockReturnValue(mockRightLeaf);

      await plugin.onload();
      await plugin.activateView();

      expect(mockApp.workspace.getRightLeaf).toHaveBeenCalledWith(false);
      expect(mockRightLeaf.setViewState).toHaveBeenCalledWith({
        type: VIEW_TYPE_CODIAN,
        active: true,
      });
    });

    it('should handle null right leaf gracefully', async () => {
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);
      mockApp.workspace.getRightLeaf.mockReturnValue(null);

      await plugin.onload();

      // Should not throw
      await expect(plugin.activateView()).resolves.not.toThrow();
    });

    it('should create new leaf in main editor area when openInMainTab is enabled', async () => {
      const mockMainLeaf = {
        setViewState: jest.fn().mockResolvedValue(undefined),
      };
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);
      mockApp.workspace.getLeaf.mockReturnValue(mockMainLeaf);

      await plugin.onload();
      plugin.settings.openInMainTab = true;
      await plugin.activateView();

      expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith('tab');
      expect(mockApp.workspace.getRightLeaf).not.toHaveBeenCalled();
      expect(mockMainLeaf.setViewState).toHaveBeenCalledWith({
        type: VIEW_TYPE_CODIAN,
        active: true,
      });
    });

    it('should handle null main leaf gracefully when openInMainTab is enabled', async () => {
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);
      mockApp.workspace.getLeaf.mockReturnValue(null);

      await plugin.onload();
      plugin.settings.openInMainTab = true;

      await expect(plugin.activateView()).resolves.not.toThrow();
    });
  });

  describe('loadSettings', () => {
    it('should merge saved data with defaults', async () => {
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.codian/obsidian/settings.json';
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.codian/obsidian/settings.json') {
          return JSON.stringify({
            enableBlocklist: false,
          });
        }
        return '';
      });

      await plugin.loadSettings();

      expect(plugin.settings.enableBlocklist).toBe(false);
      expect(plugin.settings.blockedCommands).toEqual(DEFAULT_SETTINGS.blockedCommands);
    });

    it('should normalize blockedCommands when stored value is partial', async () => {
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.codian/obsidian/settings.json';
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.codian/obsidian/settings.json') {
          return JSON.stringify({
            blockedCommands: { unix: ['rm -rf', '  '] },
          });
        }
        return '';
      });

      await plugin.loadSettings();

      expect(plugin.settings.blockedCommands.unix).toEqual(['rm -rf']);
      expect(plugin.settings.blockedCommands.windows).toEqual(DEFAULT_SETTINGS.blockedCommands.windows);
    });

    it('should use defaults when no saved data', async () => {
      // No settings file exists
      mockApp.vault.adapter.exists.mockResolvedValue(false);
      (plugin.loadData as jest.Mock).mockResolvedValue(null);

      await plugin.loadSettings();

      expect(plugin.settings).toEqual(expect.objectContaining({
        ...DEFAULT_SETTINGS,
        slashCommands: expect.any(Array),
      }));
    });

    it('should use defaults when loadData returns empty object', async () => {
      // No settings file exists
      mockApp.vault.adapter.exists.mockResolvedValue(false);
      (plugin.loadData as jest.Mock).mockResolvedValue({});

      await plugin.loadSettings();

      expect(plugin.settings).toEqual(expect.objectContaining({
        ...DEFAULT_SETTINGS,
        slashCommands: expect.any(Array),
      }));
    });

    it('keeps the static default model even when environment variables contain model overrides', async () => {
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.codian/obsidian/settings.json';
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.codian/obsidian/settings.json') {
          return JSON.stringify({
            environmentVariables: 'CODEX_MODEL=custom-model',
            lastEnvHash: '',
          });
        }
        return '';
      });

      const saveSpy = jest.spyOn(plugin, 'saveSettings');
      await plugin.loadSettings();

      expect(plugin.settings.model).toBe('gpt-5.4');
      expect(saveSpy).not.toHaveBeenCalled();
    });
  });

  describe('saveSettings', () => {
    it('should save settings to file', async () => {
      await plugin.onload();

      plugin.settings.enableBlocklist = false;

      await plugin.saveSettings();

      expect(mockApp.vault.adapter.write).toHaveBeenCalledWith(
        '.codian/obsidian/settings.json',
        expect.stringContaining('"enableBlocklist": false')
      );

      const writeCall = (mockApp.vault.adapter.write as jest.Mock).mock.calls.find(
        ([path]) => path === '.codian/obsidian/settings.json'
      );
      expect(writeCall).toBeDefined();
      const content = JSON.parse(writeCall[1]);
      expect(content).not.toHaveProperty('activeConversationId');
      expect(content).toHaveProperty('lastEnvHash');
      expect(content).toHaveProperty('lastPresetModel');
      expect(content).toHaveProperty('lastCustomModel');
      expect(content).not.toHaveProperty('permissions');
    });
  });

  describe('applyEnvironmentVariables', () => {
    it('updates runtime env vars when changed', async () => {
      await plugin.onload();
      (plugin as any).runtimeEnvironmentVariables = 'A=1';

      await plugin.applyEnvironmentVariables('A=2');
      expect((plugin as any).runtimeEnvironmentVariables).toBe('A=2');

      await plugin.applyEnvironmentVariables('A=3');
      expect((plugin as any).runtimeEnvironmentVariables).toBe('A=3');

      // No change - should not update
      const currentEnv = (plugin as any).runtimeEnvironmentVariables;
      await plugin.applyEnvironmentVariables('A=3');
      expect((plugin as any).runtimeEnvironmentVariables).toBe(currentEnv);
    });

    it('does not invalidate sessions for ignored model environment overrides', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation('session-123');
      const saveConversationSpy = jest.spyOn(plugin.storage.sessions, 'saveConversation');
      saveConversationSpy.mockClear();

      await plugin.applyEnvironmentVariables('CODEX_MODEL=gpt-5-codex');

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.sessionId).toBe('session-123');
      expect(saveConversationSpy).not.toHaveBeenCalled();
    });

    it('strips unsupported auth variables and warns the user', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation('session-123');
      const saveConversationSpy = jest.spyOn(plugin.storage.sessions, 'saveConversation');
      saveConversationSpy.mockClear();

      await plugin.applyEnvironmentVariables([
        'OPENAI_API_KEY=sk-test',
        'OPENAI_BASE_URL=https://api.example.com',
        'HTTP_PROXY=http://127.0.0.1:7890',
      ].join('\n'));

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.sessionId).toBe('session-123');
      expect(saveConversationSpy).not.toHaveBeenCalled();
      expect((plugin as any).runtimeEnvironmentVariables).toBe('HTTP_PROXY=http://127.0.0.1:7890');
      expect(plugin.settings.environmentVariables).toBe('HTTP_PROXY=http://127.0.0.1:7890');
      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining('OPENAI_API_KEY and OPENAI_BASE_URL are no longer supported in Codian.')
      );
    });

    it('broadcasts ensureReady with force when env changes without model change', async () => {
      await plugin.onload();

      // Mock getView to return a view with tabManager
      const mockEnsureReady = jest.fn().mockResolvedValue(true);
      const mockBroadcast = jest.fn().mockImplementation(async (fn) => {
        await fn({ ensureReady: mockEnsureReady });
      });
      const mockTabManager = {
        broadcastToAllTabs: mockBroadcast,
        getAllTabs: jest.fn().mockReturnValue([]),
      };
      const mockView = {
        getTabManager: jest.fn().mockReturnValue(mockTabManager),
        refreshModelSelector: jest.fn(),
      };
      jest.spyOn(plugin, 'getView').mockReturnValue(mockView as any);

      // Change env but not in a way that affects model
      await plugin.applyEnvironmentVariables('SOME_VAR=value');

      expect(mockBroadcast).toHaveBeenCalled();
      expect(mockEnsureReady).toHaveBeenCalledWith({ force: true });
    });
  });

  describe('ribbon icon callback', () => {
    it('reveals existing view when ribbon icon is clicked', async () => {
      await plugin.onload();
      const mockLeaf = { id: 'existing' };
      mockApp.workspace.getLeavesOfType.mockReturnValue([mockLeaf]);

      const ribbonCallback = (plugin.addRibbonIcon as jest.Mock).mock.calls[0][2];
      await ribbonCallback();

      expect(mockApp.workspace.revealLeaf).toHaveBeenCalledWith(mockLeaf);
    });
  });

  describe('command callback', () => {
    it('reveals existing view when command is executed', async () => {
      await plugin.onload();
      const mockLeaf = { id: 'existing' };
      mockApp.workspace.getLeavesOfType.mockReturnValue([mockLeaf]);

      const commandConfig = (plugin.addCommand as jest.Mock).mock.calls[0][0];
      await commandConfig.callback();

      expect(mockApp.workspace.revealLeaf).toHaveBeenCalledWith(mockLeaf);
    });
  });

  describe('createConversation', () => {
    it('should create a new conversation with unique ID', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      expect(conv.id).toMatch(/^conv-\d+-[a-z0-9]+$/);
      expect(conv.messages).toEqual([]);
      expect(conv.sessionId).toBeNull();
    });

    it('should allow retrieving created conversation by ID', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      const fetched = await plugin.getConversationById(conv.id);

      expect(fetched?.id).toBe(conv.id);
    });

    it('should generate default title with timestamp', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      // Title should contain month and time
      expect(conv.title).toBeTruthy();
      expect(conv.title.length).toBeGreaterThan(0);
    });

    // Note: Session management is now per-tab via TabManager
  });

  describe('switchConversation', () => {
    it('should switch to existing conversation', async () => {
      await plugin.onload();

      const conv1 = await plugin.createConversation();
      await plugin.createConversation(); // Create second conversation to switch from

      const result = await plugin.switchConversation(conv1.id);

      expect(result?.id).toBe(conv1.id);
    });

    // Note: Session ID restoration is now handled per-tab via TabManager

    it('should return null for non-existent conversation', async () => {
      await plugin.onload();

      const result = await plugin.switchConversation('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('deleteConversation', () => {
    it('should delete conversation by ID', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      const convId = conv.id;

      // Create another so we have at least one left
      await plugin.createConversation();

      await plugin.deleteConversation(convId);

      const list = plugin.getConversationList();
      expect(list.find(c => c.id === convId)).toBeUndefined();
    });

    it('should allow deleting last conversation without recreating', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.deleteConversation(conv.id);

      const list = plugin.getConversationList();
      expect(list.find(c => c.id === conv.id)).toBeUndefined();
    });
  });

  describe('renameConversation', () => {
    it('should rename conversation', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      await plugin.renameConversation(conv.id, 'New Title');

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.title).toBe('New Title');
    });

    it('should use default title if empty string provided', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      await plugin.renameConversation(conv.id, '   ');

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.title).toBeTruthy();
    });
  });

  describe('updateConversation', () => {
    it('should update conversation messages', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      const messages = [
        { id: 'msg-1', role: 'user' as const, content: 'Hello', timestamp: Date.now() },
      ];

      await plugin.updateConversation(conv.id, { messages });

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.messages).toEqual(messages);
    });

    it('should update conversation sessionId', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      await plugin.updateConversation(conv.id, { sessionId: 'new-session-id' });

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.sessionId).toBe('new-session-id');
    });

    it('should update updatedAt timestamp', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      const originalUpdatedAt = conv.updatedAt;

      // Small delay to ensure timestamp differs
      await new Promise(resolve => setTimeout(resolve, 10));

      await plugin.updateConversation(conv.id, { title: 'Changed' });

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });
  });

  describe('getConversationList', () => {
    it('should return conversation metadata', async () => {
      await plugin.onload();

      await plugin.createConversation();

      const list = plugin.getConversationList();

      expect(list.length).toBeGreaterThan(0);
      expect(list[0]).toHaveProperty('id');
      expect(list[0]).toHaveProperty('title');
      expect(list[0]).toHaveProperty('messageCount');
      expect(list[0]).toHaveProperty('preview');
    });

    it('should return preview from first user message', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello Codex', timestamp: Date.now() },
        ],
      });

      const list = plugin.getConversationList();
      const meta = list.find(c => c.id === conv.id);

      expect(meta?.preview).toContain('Hello Codex');
    });
  });

  describe('loadSettings with conversations', () => {
    it('should load saved conversations from JSONL files', async () => {
      const timestamp = Date.now();
      const sessionJsonl = JSON.stringify({
        type: 'meta',
        id: 'conv-saved-1',
        title: 'Saved Chat',
        createdAt: timestamp,
        updatedAt: timestamp,
        sessionId: 'saved-session',
      });

      // Mock files exist
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        if (path === '.codian/obsidian/sessions' || path === '.codian/obsidian/sessions/conv-saved-1.jsonl') {
          return true;
        }
        if (path === '.codian/obsidian/settings.json') {
          return true;
        }
        return false;
      });
      mockApp.vault.adapter.list.mockImplementation(async (path: string) => {
        if (path === '.codian/obsidian/sessions') {
          return { files: ['.codian/obsidian/sessions/conv-saved-1.jsonl'], folders: [] };
        }
        return { files: [], folders: [] };
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.codian/obsidian/sessions/conv-saved-1.jsonl') {
          return sessionJsonl;
        }
        if (path === '.codian/obsidian/settings.json') {
          return JSON.stringify({});
        }
        return '';
      });

      // data.json is minimal (no state - already migrated)
      (plugin.loadData as jest.Mock).mockResolvedValue({});

      await plugin.loadSettings();

      const loaded = await plugin.getConversationById('conv-saved-1');
      expect(loaded?.id).toBe('conv-saved-1');
      expect(loaded?.title).toBe('Saved Chat');
    });

    it('clears session IDs and strips unsupported auth variables from saved settings', async () => {
      const timestamp = Date.now();
      const sessionJsonl = JSON.stringify({
        type: 'meta',
        id: 'conv-saved-1',
        title: 'Saved Chat',
        createdAt: timestamp,
        updatedAt: timestamp,
        sessionId: 'saved-session',
      });

      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.codian/obsidian/settings.json' ||
          path === '.codian/obsidian/sessions' ||
          path === '.codian/obsidian/sessions/conv-saved-1.jsonl';
      });
      mockApp.vault.adapter.list.mockImplementation(async (path: string) => {
        if (path === '.codian/obsidian/sessions') {
          return { files: ['.codian/obsidian/sessions/conv-saved-1.jsonl'], folders: [] };
        }
        return { files: [], folders: [] };
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.codian/obsidian/settings.json') {
          return JSON.stringify({
            lastEnvHash: 'old-hash',
            environmentVariables: 'OPENAI_BASE_URL=https://api.example.com',
          });
        }
        if (path === '.codian/obsidian/sessions/conv-saved-1.jsonl') {
          return sessionJsonl;
        }
        return '';
      });

      // data.json is minimal (already migrated)
      (plugin.loadData as jest.Mock).mockResolvedValue({});

      await plugin.loadSettings();

      const loaded = await plugin.getConversationById('conv-saved-1');
      expect(loaded?.sessionId).toBeNull();
      expect(plugin.settings.environmentVariables).toBe('');

      const sessionWrite = (mockApp.vault.adapter.write as jest.Mock).mock.calls.find(
        ([path]) => path === '.codian/obsidian/sessions/conv-saved-1.jsonl'
      );
      expect(sessionWrite).toBeDefined();
      const metaLine = (sessionWrite?.[1] as string).split(/\r?\n/)[0];
      const meta = JSON.parse(metaLine);
      expect(meta.sessionId).toBeNull();
    });

    it('should ignore legacy activeConversationId when no sessions exist', async () => {
      // No sessions exist
      mockApp.vault.adapter.exists.mockResolvedValue(false);
      mockApp.vault.adapter.list.mockResolvedValue({ files: [], folders: [] });

      (plugin.loadData as jest.Mock).mockResolvedValue({
        activeConversationId: 'non-existent',
        migrationVersion: 2,
      });

      await plugin.loadSettings();

      expect(plugin.getConversationList()).toHaveLength(0);
    });
  });

  describe('Session metadata loading', () => {
    it('should load sdk session metadata from persisted session JSONL when present', async () => {
      const timestamp = Date.now();

      const sessionMeta = JSON.stringify({
        type: 'meta',
        id: 'conv-multi-session',
        title: 'Multi Session Chat',
        createdAt: timestamp,
        updatedAt: timestamp,
        sdkSessionId: 'session-B',
        previousSdkSessionIds: ['session-A'],
        isNative: true,
      });

      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.codian/obsidian/settings.json' ||
          path === '.codian/obsidian/sessions' ||
          path === '.codian/obsidian/sessions/conv-multi-session.jsonl';
      });
      mockApp.vault.adapter.list.mockImplementation(async (path: string) => {
        if (path === '.codian/obsidian/sessions') {
          return { files: ['.codian/obsidian/sessions/conv-multi-session.jsonl'], folders: [] };
        }
        return { files: [], folders: [] };
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.codian/obsidian/sessions/conv-multi-session.jsonl') {
          return sessionMeta;
        }
        if (path === '.codian/obsidian/settings.json') {
          return JSON.stringify({});
        }
        return '';
      });

      (plugin.loadData as jest.Mock).mockResolvedValue({});

      await plugin.loadSettings();

      const loaded = await plugin.getConversationById('conv-multi-session');
      expect(loaded?.previousSdkSessionIds).toEqual(['session-A']);
      expect(loaded?.sdkSessionId).toBe('session-B');
    });

    it('should preserve previousSdkSessionIds through conversation updates', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        sdkSessionId: 'session-B',
        previousSdkSessionIds: ['session-A'],
        isNative: true,
      });

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.previousSdkSessionIds).toEqual(['session-A']);
      expect(updated?.sdkSessionId).toBe('session-B');

      // Further update should preserve previousSdkSessionIds
      await plugin.updateConversation(conv.id, {
        title: 'Updated Title',
      });

      const afterTitleUpdate = await plugin.getConversationById(conv.id);
      expect(afterTitleUpdate?.previousSdkSessionIds).toEqual(['session-A']);
    });

    it('should handle empty previousSdkSessionIds array', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        sdkSessionId: 'session-A',
        previousSdkSessionIds: [],
        isNative: true,
      });

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.previousSdkSessionIds).toEqual([]);
    });
  });

  describe('getConversationById - fork metadata', () => {
    it('marks pending forks as loaded without mutating fork metadata', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        isNative: true,
        forkSource: { sessionId: 'source-session-abc', resumeAt: 'asst-uuid-cutoff' },
        sessionId: null,
        sdkSessionId: undefined,
        sdkMessagesLoaded: false,
      });

      const loaded = await plugin.getConversationById(conv.id);

      expect(loaded?.sdkMessagesLoaded).toBe(true);
      expect(loaded?.forkSource).toEqual({
        sessionId: 'source-session-abc',
        resumeAt: 'asst-uuid-cutoff',
      });
    });

    it('preserves an owned sdkSessionId when fork metadata is also present', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        isNative: true,
        forkSource: { sessionId: 'source-session', resumeAt: 'asst-uuid' },
        sdkSessionId: 'own-session-id',
        sdkMessagesLoaded: false,
      });

      const loaded = await plugin.getConversationById(conv.id);
      expect(loaded?.sdkSessionId).toBe('own-session-id');
      expect(loaded?.sdkMessagesLoaded).toBe(true);
    });
  });

  describe('loadSdkMessagesForConversation - subagent recovery', () => {
    it('restores subagent data when Task tool exists but subagent content block is missing', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        isNative: true,
        sdkSessionId: 'session-subagent-recovery',
        sdkMessagesLoaded: false,
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-1',
                name: 'Task',
                input: { description: 'Do sub task' },
                status: 'completed',
                result: 'Task completed',
              } as any,
            ],
            // Simulate partial persisted blocks that lost the task tool block.
            contentBlocks: [{ type: 'text', content: 'Done' }] as any,
          } as any,
        ],
        subagentData: {
          'task-1': {
            id: 'task-1',
            description: 'Recovered subagent',
            status: 'completed',
            result: 'Recovered result',
            toolCalls: [
              {
                id: 'sub-tool-1',
                name: 'Read',
                input: { file_path: 'README.md' },
                status: 'completed',
                result: 'content',
              } as any,
            ],
            isExpanded: false,
          } as any,
        },
      });

      const loaded = await plugin.getConversationById(conv.id);
      expect(loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-1')).toEqual(
        expect.objectContaining({
          subagent: expect.objectContaining({
            id: 'task-1',
            description: 'Recovered subagent',
            result: 'Recovered result',
          }),
        })
      );
      expect(loaded?.messages[0].contentBlocks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'subagent', subagentId: 'task-1' }),
        ])
      );
    });

    it('prefers richer SDK task result over stale cached subagent result', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        isNative: true,
        sdkSessionId: 'session-subagent-merge',
        sdkMessagesLoaded: false,
        messages: [
          {
            id: 'assistant-merge',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-merge-1',
                name: 'Task',
                input: { description: 'Do sub task', run_in_background: true },
                status: 'completed',
                result: 'Full SDK result from queue-operation',
              } as any,
            ],
            contentBlocks: [{ type: 'subagent', subagentId: 'task-merge-1', mode: 'async' }] as any,
          } as any,
        ],
        subagentData: {
          'task-merge-1': {
            id: 'task-merge-1',
            description: 'Recovered subagent',
            mode: 'async',
            asyncStatus: 'completed',
            status: 'completed',
            result: 'Short stale result',
            toolCalls: [],
            isExpanded: false,
          } as any,
        },
      });

      const loaded = await plugin.getConversationById(conv.id);
      const taskTool = loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-merge-1');

      expect(taskTool?.result).toBe('Full SDK result from queue-operation');
      expect(taskTool?.subagent?.result).toBe('Full SDK result from queue-operation');
    });

    it('keeps the richer cached async result when both SDK and cache are terminal', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        isNative: true,
        sdkSessionId: 'session-subagent-cache-richer',
        sdkMessagesLoaded: false,
        messages: [],
        subagentData: {
          'task-merge-2': {
            id: 'task-merge-2',
            description: 'Recovered subagent',
            mode: 'async',
            asyncStatus: 'completed',
            status: 'completed',
            result: 'Recovered final result with full details',
            toolCalls: [],
            isExpanded: false,
            agentId: 'agent-cache-richer',
          } as any,
        },
      });

      const loaded = await plugin.getConversationById(conv.id);
      const assistant = loaded?.messages.find(msg => msg.role === 'assistant');
      const taskTool = assistant?.toolCalls?.find(tc => tc.id === 'task-merge-2');

      expect(taskTool?.status).toBe('completed');
      expect(taskTool?.result).toBe('Recovered final result with full details');
      expect(taskTool?.subagent?.result).toBe('Recovered final result with full details');
    });

    it('drops stale asyncStatus from cached sync subagents during recovery', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        isNative: true,
        sdkSessionId: 'session-sync-subagent-cleanup',
        sdkMessagesLoaded: false,
        messages: [
          {
            id: 'assistant-sync',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-sync-1',
                name: 'Task',
                input: { description: 'Do sync task' },
                status: 'completed',
                result: 'Sync result',
              } as any,
            ],
            contentBlocks: [{ type: 'subagent', subagentId: 'task-sync-1', mode: 'sync' }] as any,
          } as any,
        ],
        subagentData: {
          'task-sync-1': {
            id: 'task-sync-1',
            description: 'Recovered sync subagent',
            mode: 'sync',
            asyncStatus: 'completed',
            status: 'completed',
            result: 'Recovered sync result',
            toolCalls: [],
            isExpanded: false,
          } as any,
        },
      });

      const loaded = await plugin.getConversationById(conv.id);
      const taskTool = loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-sync-1');

      expect(taskTool?.subagent?.mode).toBe('sync');
      expect(taskTool?.subagent?.asyncStatus).toBeUndefined();
    });

    it('prefers terminal task state already present in messages over stale cached running state', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        isNative: true,
        sdkSessionId: 'session-async-sdk-terminal',
        sdkMessagesLoaded: false,
        messages: [
          {
            id: 'assistant-sdk-terminal',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-async-sdk-terminal',
                name: 'Task',
                input: { description: 'SDK async subagent', run_in_background: true },
                status: 'completed',
                result: 'Full SDK final result',
                subagent: {
                  id: 'task-async-sdk-terminal',
                  description: 'SDK async subagent',
                  mode: 'async',
                  asyncStatus: 'completed',
                  status: 'completed',
                  result: 'Full SDK final result',
                  toolCalls: [],
                  isExpanded: false,
                  agentId: 'agent-sdk-terminal',
                },
              } as any,
            ],
            contentBlocks: [{ type: 'subagent', subagentId: 'task-async-sdk-terminal', mode: 'async' }] as any,
          } as any,
        ],
        subagentData: {
          'task-async-sdk-terminal': {
            id: 'task-async-sdk-terminal',
            description: 'Cached async subagent',
            mode: 'async',
            asyncStatus: 'running',
            status: 'running',
            result: 'Still running',
            toolCalls: [],
            isExpanded: false,
          } as any,
        },
      });

      const loaded = await plugin.getConversationById(conv.id);
      const taskTool = loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-async-sdk-terminal');

      expect(taskTool?.status).toBe('completed');
      expect(taskTool?.result).toBe('Full SDK final result');
      expect(taskTool?.subagent?.status).toBe('completed');
      expect(taskTool?.subagent?.asyncStatus).toBe('completed');
      expect(taskTool?.subagent?.result).toBe('Full SDK final result');
    });

    it('prefers cached terminal async status over SDK launch-only running state', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        isNative: true,
        sdkSessionId: 'session-async-cache-terminal',
        sdkMessagesLoaded: false,
        messages: [
          {
            id: 'assistant-sdk-running',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-async-cache-terminal',
                name: 'Task',
                input: { description: 'SDK async subagent', run_in_background: true },
                status: 'running',
                result: 'Task launched in background.',
                subagent: {
                  id: 'task-async-cache-terminal',
                  description: 'SDK async subagent',
                  mode: 'async',
                  asyncStatus: 'running',
                  status: 'running',
                  result: 'Task launched in background.',
                  toolCalls: [],
                  isExpanded: false,
                  agentId: 'agent-cache-terminal',
                },
              } as any,
            ],
            contentBlocks: [{ type: 'subagent', subagentId: 'task-async-cache-terminal', mode: 'async' }] as any,
          } as any,
        ],
        subagentData: {
          'task-async-cache-terminal': {
            id: 'task-async-cache-terminal',
            description: 'Cached async subagent',
            mode: 'async',
            asyncStatus: 'completed',
            status: 'completed',
            result: 'Recovered final result',
            toolCalls: [],
            isExpanded: false,
            agentId: 'agent-cache-terminal',
          } as any,
        },
      });

      const loaded = await plugin.getConversationById(conv.id);
      const assistant = loaded?.messages.find(msg => msg.id === 'assistant-sdk-running');
      const taskTool = assistant?.toolCalls?.find(tc => tc.id === 'task-async-cache-terminal');

      expect(taskTool?.status).toBe('completed');
      expect(taskTool?.result).toBe('Recovered final result');
      expect(taskTool?.subagent?.status).toBe('completed');
      expect(taskTool?.subagent?.asyncStatus).toBe('completed');
      expect(taskTool?.subagent?.result).toBe('Recovered final result');
    });

    it('restores async subagent data and mode when Task tool exists but async block is missing', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        isNative: true,
        sdkSessionId: 'session-async-subagent-recovery',
        sdkMessagesLoaded: false,
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-async-1',
                name: 'Task',
                input: { description: 'Do background task', run_in_background: true },
                status: 'completed',
                result: 'Task started',
              } as any,
            ],
            contentBlocks: [{ type: 'text', content: 'Started' }] as any,
          } as any,
        ],
        subagentData: {
          'task-async-1': {
            id: 'task-async-1',
            description: 'Recovered async subagent',
            mode: 'async',
            asyncStatus: 'completed',
            status: 'completed',
            result: 'Recovered async result',
            toolCalls: [],
            isExpanded: false,
          } as any,
        },
      });

      const loaded = await plugin.getConversationById(conv.id);
      const block = loaded?.messages[0].contentBlocks?.find(
        (b: any) => b.type === 'subagent' && b.subagentId === 'task-async-1'
      ) as any;

      expect(loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-async-1')).toEqual(
        expect.objectContaining({
          id: 'task-async-1',
          subagent: expect.objectContaining({
            id: 'task-async-1',
            mode: 'async',
            asyncStatus: 'completed',
          }),
        })
      );
      expect(block).toEqual(
        expect.objectContaining({ type: 'subagent', subagentId: 'task-async-1', mode: 'async' })
      );
    });

    it('preserves cached async subagent tool calls on reload', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        isNative: true,
        sdkSessionId: 'session-async-subagent-tools',
        sdkMessagesLoaded: false,
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-async-tools',
                name: 'Task',
                input: { description: 'Do background task', run_in_background: true },
                status: 'completed',
                result: 'Task started',
              } as any,
            ],
            contentBlocks: [{ type: 'subagent', subagentId: 'task-async-tools', mode: 'async' }] as any,
          } as any,
        ],
        subagentData: {
          'task-async-tools': {
            id: 'task-async-tools',
            description: 'Recovered async subagent',
            mode: 'async',
            asyncStatus: 'completed',
            status: 'completed',
            result: 'Recovered async result',
            agentId: 'agent-a123',
            toolCalls: [
              {
                id: 'sub-tool-1',
                name: 'Bash',
                input: { command: 'ls' },
                status: 'completed',
                result: 'ok',
                isExpanded: false,
              } as any,
            ],
            isExpanded: false,
          } as any,
        },
      });

      const loaded = await plugin.getConversationById(conv.id);
      const taskTool = loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-async-tools');

      expect(taskTool?.subagent?.toolCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'sub-tool-1',
            name: 'Bash',
            result: 'ok',
          }),
        ])
      );
    });

    it('keeps async subagent renderer visible when task block and task tool call are both missing', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        isNative: true,
        sdkSessionId: 'session-async-subagent-fallback',
        sdkMessagesLoaded: false,
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Background work started',
            timestamp: 1000,
            contentBlocks: [{ type: 'text', content: 'Background work started' }] as any,
          } as any,
        ],
        subagentData: {
          'task-async-orphan': {
            id: 'task-async-orphan',
            description: 'Recovered async orphan subagent',
            mode: 'async',
            asyncStatus: 'running',
            status: 'running',
            result: 'Running in background',
            toolCalls: [],
            isExpanded: false,
          } as any,
        },
      });

      const loaded = await plugin.getConversationById(conv.id);
      const assistant = loaded?.messages.find(m => m.id === 'assistant-1');
      const block = assistant?.contentBlocks?.find(
        (b: any) => b.type === 'subagent' && b.subagentId === 'task-async-orphan'
      ) as any;

      expect(assistant?.toolCalls?.find((tc: any) => tc.id === 'task-async-orphan')).toEqual(
        expect.objectContaining({
          id: 'task-async-orphan',
          name: TOOL_TASK,
          subagent: expect.objectContaining({
            id: 'task-async-orphan',
            mode: 'async',
            asyncStatus: 'running',
          }),
        })
      );
      expect(block).toEqual(
        expect.objectContaining({
          type: 'subagent',
          subagentId: 'task-async-orphan',
          mode: 'async',
        })
      );
    });
  });

});
