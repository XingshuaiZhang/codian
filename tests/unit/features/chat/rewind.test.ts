import type { ChatMessage } from '@/core/types';
import { collectRewindTurnTargets, findRewindContext } from '@/features/chat/rewind';

describe('findRewindContext', () => {
  it('finds the nearest previous assistant UUID and detects a following response UUID', () => {
    const messages: ChatMessage[] = [
      { id: 'a0', role: 'assistant', content: 'no uuid', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'prev', timestamp: 2, sdkAssistantUuid: 'prev-a' },
      { id: 'u1', role: 'user', content: 'user', timestamp: 3, sdkUserUuid: 'user-u' },
      { id: 'a2', role: 'assistant', content: 'no uuid', timestamp: 4 },
      { id: 'a3', role: 'assistant', content: 'resp', timestamp: 5, sdkAssistantUuid: 'resp-a' },
    ];

    const ctx = findRewindContext(messages, 2);
    expect(ctx.prevAssistantUuid).toBe('prev-a');
    expect(ctx.hasResponse).toBe(true);
  });

  it('does not treat assistants after the next user message as a response', () => {
    const messages: ChatMessage[] = [
      { id: 'a1', role: 'assistant', content: 'prev', timestamp: 1, sdkAssistantUuid: 'prev-a' },
      { id: 'u1', role: 'user', content: 'user', timestamp: 2, sdkUserUuid: 'user-u' },
      { id: 'a2', role: 'assistant', content: 'no uuid', timestamp: 3 },
      { id: 'u2', role: 'user', content: 'next user', timestamp: 4, sdkUserUuid: 'user-u2' },
      { id: 'a3', role: 'assistant', content: 'later resp', timestamp: 5, sdkAssistantUuid: 'resp-a' },
    ];

    const ctx = findRewindContext(messages, 1);
    expect(ctx.prevAssistantUuid).toBe('prev-a');
    expect(ctx.hasResponse).toBe(false);
  });

  it('returns prevAssistantUuid as undefined when no prior assistant UUID exists', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'user', timestamp: 1, sdkUserUuid: 'user-u' },
      { id: 'a1', role: 'assistant', content: 'resp', timestamp: 2, sdkAssistantUuid: 'resp-a' },
    ];

    const ctx = findRewindContext(messages, 0);
    expect(ctx.prevAssistantUuid).toBeUndefined();
    expect(ctx.hasResponse).toBe(true);
  });

  it('returns hasResponse as false when no following assistant UUID exists', () => {
    const messages: ChatMessage[] = [
      { id: 'a1', role: 'assistant', content: 'prev', timestamp: 1, sdkAssistantUuid: 'prev-a' },
      { id: 'u1', role: 'user', content: 'user', timestamp: 2, sdkUserUuid: 'user-u' },
      { id: 'a2', role: 'assistant', content: 'no uuid', timestamp: 3 },
    ];

    const ctx = findRewindContext(messages, 1);
    expect(ctx.prevAssistantUuid).toBe('prev-a');
    expect(ctx.hasResponse).toBe(false);
  });
});

describe('collectRewindTurnTargets', () => {
  it('collects the selected turn and all later user turns', () => {
    const messages: ChatMessage[] = [
      { id: 'a0', role: 'assistant', content: 'prev', timestamp: 1, sdkAssistantUuid: 'prev-a' },
      { id: 'u1', role: 'user', content: 'first', timestamp: 2, sdkUserUuid: 'turn-1' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'wrote file',
        timestamp: 3,
        toolCalls: [{ id: 'write-1', name: 'Write', input: {}, status: 'completed' }],
      },
      { id: 'u2', role: 'user', content: 'second', timestamp: 4, sdkUserUuid: 'turn-2' },
      {
        id: 'a2',
        role: 'assistant',
        content: 'read only',
        timestamp: 5,
        toolCalls: [{ id: 'read-1', name: 'Read', input: {}, status: 'completed' }],
      },
      { id: 'u3', role: 'user', content: 'third', timestamp: 6, sdkUserUuid: 'turn-3' },
      { id: 'a3', role: 'assistant', content: 'plain reply', timestamp: 7 },
    ];

    expect(collectRewindTurnTargets(messages, 1)).toEqual([
      { turnId: 'turn-1', expectsFileRestore: true },
      { turnId: 'turn-2', expectsFileRestore: false },
      { turnId: 'turn-3', expectsFileRestore: false },
    ]);
  });

  it('treats bash-backed turns as needing best-effort file restore', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'run command', timestamp: 1, sdkUserUuid: 'turn-1' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'done',
        timestamp: 2,
        toolCalls: [{ id: 'bash-1', name: 'Bash', input: { command: 'touch file' }, status: 'completed' }],
      },
    ];

    expect(collectRewindTurnTargets(messages, 0)).toEqual([
      { turnId: 'turn-1', expectsFileRestore: true },
    ]);
  });
});
