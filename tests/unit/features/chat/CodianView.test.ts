import { ItemView, WorkspaceLeaf } from 'obsidian';

import { CodianView } from '@/features/chat/CodianView';

import { createMockEl } from '../../../helpers/mockElement';

function createPlugin(): any {
  return {
    settings: {
      customContextLimits: {},
      hiddenSlashCommands: [],
    },
    storage: {
      setTabManagerState: jest.fn().mockResolvedValue(undefined),
    },
    app: {
      vault: {
        on: jest.fn(),
        offref: jest.fn(),
      },
      workspace: {
        on: jest.fn(),
      },
    },
  };
}

describe('CodianView load fallback', () => {
  const originalLoad = (ItemView as any).prototype.load;

  afterEach(() => {
    if (originalLoad === undefined) {
      delete (ItemView as any).prototype.load;
    } else {
      (ItemView as any).prototype.load = originalLoad;
    }
    jest.restoreAllMocks();
  });

  it('falls back to onOpen when base ItemView load is unavailable', async () => {
    delete (ItemView as any).prototype.load;

    const view = new CodianView(new WorkspaceLeaf() as any, createPlugin());
    const onOpenSpy = jest.spyOn(view, 'onOpen').mockResolvedValue(undefined);

    await expect((view as any).load()).resolves.toBeUndefined();
    expect(onOpenSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to onOpen when base load fails before initialization', async () => {
    (ItemView as any).prototype.load = jest.fn().mockRejectedValue(new Error('boom'));

    const view = new CodianView(new WorkspaceLeaf() as any, createPlugin());
    const onOpenSpy = jest.spyOn(view, 'onOpen').mockResolvedValue(undefined);

    await expect((view as any).load()).resolves.toBeUndefined();
    expect(onOpenSpy).toHaveBeenCalledTimes(1);
  });

  it('rethrows errors when the view was already initialized before load failed', async () => {
    const loadError = new Error('boom');
    (ItemView as any).prototype.load = jest.fn().mockImplementation(function (this: any) {
      this.tabManager = {};
      return Promise.reject(loadError);
    });

    const view = new CodianView(new WorkspaceLeaf() as any, createPlugin());
    const onOpenSpy = jest.spyOn(view, 'onOpen').mockResolvedValue(undefined);

    await expect((view as any).load()).rejects.toThrow(loadError);
    expect(onOpenSpy).not.toHaveBeenCalled();
  });

  it('clears the stale fallback container when the real contentEl appears later', () => {
    const view = new CodianView(new WorkspaceLeaf() as any, createPlugin());

    const root = createMockEl();
    const placeholder = createMockEl();
    const fallbackContainer = createMockEl();
    const contentEl = createMockEl();

    root.children.push(placeholder, fallbackContainer, contentEl);
    (view as any).containerEl = root;

    fallbackContainer.createDiv({ text: 'stale' });
    (view as any).contentEl = null;
    expect((view as any).prepareViewContainer()).toBe(fallbackContainer);
    fallbackContainer.createDiv({ text: 'first render' });

    contentEl.createDiv({ text: 'stale contentEl' });
    (view as any).contentEl = contentEl;

    expect((view as any).prepareViewContainer()).toBe(contentEl);
    expect(fallbackContainer.children).toHaveLength(0);
    expect(fallbackContainer.hasClass('codian-container')).toBe(false);
    expect(contentEl.children).toHaveLength(0);
    expect(contentEl.hasClass('codian-container')).toBe(true);
  });

  it('does not overwrite the base view headerEl when building its internal header', () => {
    const view = new CodianView(new WorkspaceLeaf() as any, createPlugin());
    const nativeHeaderEl = createMockEl();
    const contentHeaderEl = createMockEl();

    (view as any).headerEl = nativeHeaderEl;
    (view as any).buildHeader(contentHeaderEl);

    expect((view as any).headerEl).toBe(nativeHeaderEl);
    expect((view as any).contentHeaderEl).toBe(contentHeaderEl);
  });

  it('destroys previous tab state before rebuilding the same view', async () => {
    const plugin = createPlugin();
    const view = new CodianView(new WorkspaceLeaf() as any, plugin);
    const destroyTabManager = jest.fn().mockResolvedValue(undefined);
    const destroyTabBar = jest.fn();
    const ref = {} as any;

    (view as any).tabManager = { destroy: destroyTabManager };
    (view as any).tabBar = { destroy: destroyTabBar };
    (view as any).tabBarContainerEl = createMockEl();
    (view as any).tabContentEl = createMockEl();
    (view as any).navRowContent = createMockEl();
    (view as any).contentHeaderEl = createMockEl();
    (view as any).titleSlotEl = createMockEl();
    (view as any).logoEl = createMockEl();
    (view as any).titleTextEl = createMockEl();
    (view as any).headerActionsEl = createMockEl();
    (view as any).headerActionsContent = createMockEl();
    (view as any).historyDropdown = createMockEl();
    (view as any).eventRefs = [ref];

    await (view as any).resetForReopen();

    expect(destroyTabManager).toHaveBeenCalledTimes(1);
    expect(destroyTabBar).toHaveBeenCalledTimes(1);
    expect(plugin.app.vault.offref).toHaveBeenCalledWith(ref);
    expect((view as any).tabManager).toBeNull();
    expect((view as any).tabBar).toBeNull();
    expect((view as any).viewContainerEl).toBeNull();
    expect((view as any).tabContentEl).toBeNull();
    expect((view as any).contentHeaderEl).toBeNull();
    expect((view as any).historyDropdown).toBeNull();
  });

  it('resets lifecycle wiring when the view closes so it can reopen cleanly', async () => {
    const plugin = createPlugin();
    const view = new CodianView(new WorkspaceLeaf() as any, plugin);
    const persistedState = { openTabs: [], activeTabId: null };
    const destroyTabManager = jest.fn().mockResolvedValue(undefined);
    const destroyTabBar = jest.fn();
    const ref = {} as any;

    (view as any).tabManager = {
      destroy: destroyTabManager,
      getPersistedState: jest.fn().mockReturnValue(persistedState),
    };
    (view as any).tabBar = { destroy: destroyTabBar };
    (view as any).viewContainerEl = createMockEl();
    (view as any).tabBarContainerEl = createMockEl();
    (view as any).tabContentEl = createMockEl();
    (view as any).navRowContent = createMockEl();
    (view as any).contentHeaderEl = createMockEl();
    (view as any).titleSlotEl = createMockEl();
    (view as any).logoEl = createMockEl();
    (view as any).titleTextEl = createMockEl();
    (view as any).headerActionsEl = createMockEl();
    (view as any).headerActionsContent = createMockEl();
    (view as any).historyDropdown = createMockEl();
    (view as any).viewEventsWired = true;
    (view as any).eventRefs = [ref];

    await view.onClose();

    expect(plugin.storage.setTabManagerState).toHaveBeenCalledWith(persistedState);
    expect(plugin.app.vault.offref).toHaveBeenCalledWith(ref);
    expect(destroyTabManager).toHaveBeenCalledTimes(1);
    expect(destroyTabBar).toHaveBeenCalledTimes(1);
    expect((view as any).tabManager).toBeNull();
    expect((view as any).tabBar).toBeNull();
    expect((view as any).viewContainerEl).toBeNull();
    expect((view as any).tabContentEl).toBeNull();
    expect((view as any).historyDropdown).toBeNull();
    expect((view as any).viewEventsWired).toBe(false);
  });
});
