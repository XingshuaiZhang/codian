import { ItemView, WorkspaceLeaf } from 'obsidian';

import { CodianView } from '@/features/chat/CodianView';

function createPlugin(): any {
  return {
    settings: {
      customContextLimits: {},
      hiddenSlashCommands: [],
    },
    app: {},
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
});
