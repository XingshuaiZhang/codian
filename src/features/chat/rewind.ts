import { TOOL_BASH, TOOL_EDIT, TOOL_NOTEBOOK_EDIT, TOOL_WRITE } from '../../core/tools/toolNames';
import type { ChatMessage, ToolCallInfo } from '../../core/types';

export interface RewindContext {
  prevAssistantUuid: string | undefined;
  hasResponse: boolean;
}

export interface RewindTurnTarget {
  turnId: string;
  expectsFileRestore: boolean;
}

/**
 * Scans around a user message to find the previous assistant UUID (rewind target)
 * and whether a response with a UUID follows it (proving the SDK processed it).
 */
export function findRewindContext(messages: ChatMessage[], userIndex: number): RewindContext {
  let prevAssistantUuid: string | undefined;
  for (let i = userIndex - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].sdkAssistantUuid) {
      prevAssistantUuid = messages[i].sdkAssistantUuid;
      break;
    }
  }

  let hasResponse = false;
  for (let i = userIndex + 1; i < messages.length; i++) {
    if (messages[i].role === 'user') break;
    if (messages[i].role === 'assistant' && messages[i].sdkAssistantUuid) {
      hasResponse = true;
      break;
    }
  }

  return { prevAssistantUuid, hasResponse };
}

function isMutatingToolCall(toolCall: ToolCallInfo): boolean {
  return toolCall.name === TOOL_WRITE
    || toolCall.name === TOOL_EDIT
    || toolCall.name === TOOL_NOTEBOOK_EDIT
    || toolCall.name === TOOL_BASH;
}

function turnExpectsFileRestore(messages: ChatMessage[], userIndex: number): boolean {
  for (let i = userIndex + 1; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === 'user') {
      break;
    }
    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      continue;
    }
    if (message.toolCalls.some(isMutatingToolCall)) {
      return true;
    }
  }
  return false;
}

export function collectRewindTurnTargets(messages: ChatMessage[], userIndex: number): RewindTurnTarget[] {
  const targets: RewindTurnTarget[] = [];

  for (let i = userIndex; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== 'user' || !message.sdkUserUuid) {
      continue;
    }

    targets.push({
      turnId: message.sdkUserUuid,
      expectsFileRestore: turnExpectsFileRestore(messages, i),
    });
  }

  return targets;
}
