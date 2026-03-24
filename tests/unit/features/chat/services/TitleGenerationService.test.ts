import { type TitleGenerationResult, TitleGenerationService } from '@/features/chat/services/TitleGenerationService';
import { runCodexText } from '@/utils/codexCli';

jest.mock('@/utils/codexCli', () => ({
  runCodexText: jest.fn(),
}));

const mockRunCodexText = jest.mocked(runCodexText);

function createMockPlugin(settings = {}) {
  return {
    settings: {
      model: 'gpt-5-codex',
      titleGenerationModel: '',
      thinkingBudget: 'off',
      ...settings,
    },
    app: {
      vault: {
        adapter: {
          basePath: '/test/vault/path',
        },
      },
    },
    getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
    getResolvedCodexCliPath: jest.fn().mockReturnValue('/fake/codex'),
  } as any;
}

function createRunResult(text: string) {
  return {
    text,
    sessionId: null,
    stderr: '',
    exitCode: 0,
  };
}

describe('TitleGenerationService', () => {
  let service: TitleGenerationService;
  let mockPlugin: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlugin = createMockPlugin();
    service = new TitleGenerationService(mockPlugin);
  });

  describe('generateTitle', () => {
    it('generates a cleaned title from the first user message', async () => {
      mockRunCodexText.mockResolvedValueOnce(createRunResult('"Setting Up React Project..."'));

      const callback = jest.fn(async () => {});
      await service.generateTitle('conv-123', 'How do I set up a React project?', callback);

      expect(callback).toHaveBeenCalledWith('conv-123', {
        success: true,
        title: 'Setting Up React Project',
      });
    });

    it('uses ephemeral read-only Codex calls and configured title model', async () => {
      mockPlugin.settings.titleGenerationModel = 'gpt-5';
      mockRunCodexText.mockResolvedValueOnce(createRunResult('Test Title'));

      const callback = jest.fn(async () => {});
      await service.generateTitle('conv-123', 'test', callback);

      expect(mockRunCodexText).toHaveBeenCalledWith(expect.objectContaining({
        plugin: mockPlugin,
        model: 'gpt-5',
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        ephemeral: true,
        signal: expect.any(AbortSignal),
      }));
    });

    it('leaves the model unset when no titleGenerationModel is configured', async () => {
      mockRunCodexText.mockResolvedValueOnce(createRunResult('Test Title'));

      const callback = jest.fn(async () => {});
      await service.generateTitle('conv-123', 'test', callback);

      expect(mockRunCodexText.mock.calls[0][0]).toEqual(expect.objectContaining({
        model: undefined,
      }));
    });

    it('truncates long user messages before sending the prompt', async () => {
      const longMessage = 'x'.repeat(700);
      mockRunCodexText.mockResolvedValueOnce(createRunResult('Title'));

      const callback = jest.fn(async () => {});
      await service.generateTitle('conv-123', longMessage, callback);

      const prompt = mockRunCodexText.mock.calls[0][0].prompt;
      expect(prompt).toContain('x'.repeat(500));
      expect(prompt).toContain('...');
      expect(prompt).not.toContain('x'.repeat(600));
    });

    it('returns parse failures when the response is empty', async () => {
      mockRunCodexText.mockResolvedValueOnce(createRunResult(''));

      const callback = jest.fn(async () => {});
      await service.generateTitle('conv-123', 'test', callback);

      expect(callback).toHaveBeenCalledWith('conv-123', {
        success: false,
        error: 'Failed to parse title from response',
      });
    });

    it('returns an error when Codex CLI is not found', async () => {
      mockPlugin.getResolvedCodexCliPath.mockReturnValue(null);

      const callback = jest.fn(async () => {});
      await service.generateTitle('conv-123', 'test', callback);

      expect(callback).toHaveBeenCalledWith('conv-123', {
        success: false,
        error: 'Codex CLI not found',
      });
      expect(mockRunCodexText).not.toHaveBeenCalled();
    });
  });

  describe('concurrent generation', () => {
    it('supports independent generations for multiple conversations', async () => {
      mockRunCodexText
        .mockResolvedValueOnce(createRunResult('Title 1'))
        .mockResolvedValueOnce(createRunResult('Title 2'));

      const callback1 = jest.fn(async () => {});
      const callback2 = jest.fn(async () => {});

      await Promise.all([
        service.generateTitle('conv-1', 'msg1', callback1),
        service.generateTitle('conv-2', 'msg2', callback2),
      ]);

      expect(callback1).toHaveBeenCalledWith('conv-1', { success: true, title: 'Title 1' });
      expect(callback2).toHaveBeenCalledWith('conv-2', { success: true, title: 'Title 2' });
    });

    it('aborts the previous generation when the same conversation starts again', async () => {
      mockRunCodexText
        .mockImplementationOnce(
          ({ signal }) =>
            new Promise((_, reject) => {
              signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
            })
        )
        .mockResolvedValueOnce(createRunResult('Title 2'));

      const callback1 = jest.fn(async () => {});
      const callback2 = jest.fn(async () => {});

      const promise1 = service.generateTitle('conv-1', 'msg1', callback1);
      await Promise.resolve();
      const promise2 = service.generateTitle('conv-1', 'msg2', callback2);

      await Promise.all([promise1, promise2]);

      expect(callback1).toHaveBeenCalledWith('conv-1', {
        success: false,
        error: 'Aborted',
      });
      expect(callback2).toHaveBeenCalledWith('conv-1', {
        success: true,
        title: 'Title 2',
      });
    });
  });

  describe('cancel', () => {
    it('aborts all active title generations', async () => {
      mockRunCodexText.mockImplementation(
        ({ signal }) =>
          new Promise((_, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
          })
      );

      const callback1 = jest.fn(async () => {});
      const callback2 = jest.fn(async () => {});

      const promise1 = service.generateTitle('conv-1', 'msg1', callback1);
      const promise2 = service.generateTitle('conv-2', 'msg2', callback2);

      await Promise.resolve();
      service.cancel();
      await Promise.all([promise1, promise2]);

      expect(callback1).toHaveBeenCalledWith('conv-1', {
        success: false,
        error: 'Cancelled',
      });
      expect(callback2).toHaveBeenCalledWith('conv-2', {
        success: false,
        error: 'Cancelled',
      });
    });
  });

  describe('safeCallback', () => {
    it('swallows callback failures', async () => {
      mockRunCodexText.mockResolvedValueOnce(createRunResult('Title'));
      const throwingCallback = jest.fn().mockRejectedValue(new Error('Callback error'));

      await expect(
        service.generateTitle('conv-123', 'test', throwingCallback)
      ).resolves.not.toThrow();
    });
  });
});

describe('TitleGenerationResult type', () => {
  it('supports success results', () => {
    const success: TitleGenerationResult = { success: true, title: 'Test Title' };
    expect(success).toEqual({ success: true, title: 'Test Title' });
  });

  it('supports failure results', () => {
    const failure: TitleGenerationResult = { success: false, error: 'Some error' };
    expect(failure).toEqual({ success: false, error: 'Some error' });
  });
});
