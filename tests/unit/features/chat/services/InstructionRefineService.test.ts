import { InstructionRefineService } from '@/features/chat/services/InstructionRefineService';
import { runCodexText } from '@/utils/codexCli';

jest.mock('@/utils/codexCli', () => ({
  runCodexText: jest.fn(),
}));

const mockRunCodexText = jest.mocked(runCodexText);

function createMockPlugin(settings = {}) {
  return {
    settings: {
      model: 'gpt-5-codex',
      thinkingBudget: 'off',
      systemPrompt: '',
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

function createRunResult(text: string, sessionId = 'test-session') {
  return {
    text,
    sessionId,
    stderr: '',
    exitCode: 0,
  };
}

describe('InstructionRefineService', () => {
  let service: InstructionRefineService;
  let mockPlugin: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlugin = createMockPlugin();
    service = new InstructionRefineService(mockPlugin);
  });

  describe('refineInstruction', () => {
    it('uses Codex text-only refinement options and parses instruction tags', async () => {
      mockRunCodexText.mockResolvedValueOnce(
        createRunResult('<instruction>- Be concise.</instruction>')
      );

      const existing = '## Existing\n\n- Keep it short.';
      const result = await service.refineInstruction('be concise', existing);

      expect(result).toEqual({
        success: true,
        refinedInstruction: '- Be concise.',
      });
      expect(mockRunCodexText).toHaveBeenCalledWith(expect.objectContaining({
        plugin: mockPlugin,
        sessionId: null,
        model: 'gpt-5-codex',
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        signal: expect.any(AbortSignal),
      }));

      const prompt = mockRunCodexText.mock.calls[0][0].prompt;
      expect(prompt).toContain('<system_instructions>');
      expect(prompt).toContain(existing);
      expect(prompt).toContain('Please refine this instruction: "be concise"');
    });

    it('returns clarification when the model asks a follow-up question', async () => {
      mockRunCodexText.mockResolvedValueOnce(
        createRunResult('Could you clarify what you mean by concise?')
      );

      const result = await service.refineInstruction('be concise', '');

      expect(result).toEqual({
        success: true,
        clarification: 'Could you clarify what you mean by concise?',
      });
    });

    it('returns empty response errors', async () => {
      mockRunCodexText.mockResolvedValueOnce(createRunResult(''));

      const result = await service.refineInstruction('be concise', '');

      expect(result).toEqual({
        success: false,
        error: 'Empty response',
      });
    });

    it('reports parsed progress updates while streaming', async () => {
      mockRunCodexText.mockImplementationOnce(async (options) => {
        options.onProgress?.('<instruction>- Be brief.</instruction>');
        return createRunResult('<instruction>- Be brief.</instruction>');
      });

      const onProgress = jest.fn();
      await service.refineInstruction('be concise', '', onProgress);

      expect(onProgress).toHaveBeenCalledWith({
        success: true,
        refinedInstruction: '- Be brief.',
      });
    });
  });

  describe('continueConversation', () => {
    it('returns an error when no session is active', async () => {
      const result = await service.continueConversation('follow up');

      expect(result).toEqual({
        success: false,
        error: 'No active conversation to continue',
      });
    });

    it('resumes the stored Codex session after the first refinement', async () => {
      mockRunCodexText
        .mockResolvedValueOnce(createRunResult('What do you mean?', 'session-abc'))
        .mockResolvedValueOnce(
          createRunResult('<instruction>- Be concise and clear.</instruction>', 'session-abc')
        );

      await service.refineInstruction('test', '');
      const result = await service.continueConversation('I mean short answers');

      expect(result).toEqual({
        success: true,
        refinedInstruction: '- Be concise and clear.',
      });
      expect(mockRunCodexText.mock.calls[1][0]).toEqual(expect.objectContaining({
        sessionId: 'session-abc',
      }));
    });
  });

  describe('resetConversation', () => {
    it('clears the stored session', async () => {
      mockRunCodexText.mockResolvedValueOnce(createRunResult('clarification', 'session-abc'));

      await service.refineInstruction('test', '');
      service.resetConversation();

      const result = await service.continueConversation('follow up');
      expect(result).toEqual({
        success: false,
        error: 'No active conversation to continue',
      });
    });
  });

  describe('cancel', () => {
    it('aborts the active Codex request', async () => {
      let capturedSignal: AbortSignal | undefined;
      mockRunCodexText.mockImplementationOnce(
        ({ signal }) =>
          new Promise((_, reject) => {
            capturedSignal = signal;
            signal?.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
          })
      );

      const promise = service.refineInstruction('test', '');
      service.cancel();
      const result = await promise;

      expect(capturedSignal?.aborted).toBe(true);
      expect(result).toEqual({
        success: false,
        error: 'Cancelled',
      });
    });

    it('is safe to cancel when nothing is running', () => {
      expect(() => service.cancel()).not.toThrow();
    });
  });

  describe('error handling', () => {
    it('returns an error when Codex CLI is not available', async () => {
      mockPlugin.getResolvedCodexCliPath.mockReturnValue(null);

      const result = await service.refineInstruction('test', '');

      expect(result).toEqual({
        success: false,
        error: 'Codex CLI not found. Please install Codex CLI.',
      });
      expect(mockRunCodexText).not.toHaveBeenCalled();
    });

    it('returns runCodexText failures as service errors', async () => {
      mockRunCodexText.mockRejectedValueOnce(new Error('spawn failed'));

      const result = await service.refineInstruction('test', '');

      expect(result).toEqual({
        success: false,
        error: 'spawn failed',
      });
    });
  });
});
