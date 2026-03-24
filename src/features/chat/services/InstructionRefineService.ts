import { buildRefineSystemPrompt } from '../../../core/prompts/instructionRefine';
import { type InstructionRefineResult } from '../../../core/types';
import type CodianPlugin from '../../../main';
import { runCodexText } from '../../../utils/codexCli';

export type RefineProgressCallback = (update: InstructionRefineResult) => void;

export class InstructionRefineService {
  private plugin: CodianPlugin;
  private abortController: AbortController | null = null;
  private sessionId: string | null = null;
  private existingInstructions: string = '';

  constructor(plugin: CodianPlugin) {
    this.plugin = plugin;
  }

  /** Resets conversation state for a new refinement session. */
  resetConversation(): void {
    this.sessionId = null;
  }

  /** Refines a raw instruction from user input. */
  async refineInstruction(
    rawInstruction: string,
    existingInstructions: string,
    onProgress?: RefineProgressCallback
  ): Promise<InstructionRefineResult> {
    this.sessionId = null;
    this.existingInstructions = existingInstructions;
    const prompt = `Please refine this instruction: "${rawInstruction}"`;
    return this.sendMessage(prompt, onProgress);
  }

  /** Continues conversation with a follow-up message (for clarifications). */
  async continueConversation(
    message: string,
    onProgress?: RefineProgressCallback
  ): Promise<InstructionRefineResult> {
    if (!this.sessionId) {
      return { success: false, error: 'No active conversation to continue' };
    }
    return this.sendMessage(message, onProgress);
  }

  /** Cancels any ongoing query. */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private async sendMessage(
    prompt: string,
    onProgress?: RefineProgressCallback
  ): Promise<InstructionRefineResult> {
    if (!this.plugin.getResolvedCodexCliPath()) {
      return { success: false, error: 'Codex CLI not found. Please install Codex CLI.' };
    }

    this.abortController = new AbortController();

    try {
      const response = await runCodexText({
        plugin: this.plugin,
        prompt: [
          `<system_instructions>`,
          buildRefineSystemPrompt(this.existingInstructions),
          `</system_instructions>`,
          '',
          prompt,
        ].join('\n'),
        sessionId: this.sessionId,
        model: this.plugin.settings.model,
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        signal: this.abortController.signal,
        onProgress: onProgress
          ? (text) => {
              onProgress(this.parseResponse(text));
            }
          : undefined,
      });

      this.sessionId = response.sessionId;
      return this.parseResponse(response.text);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: msg };
    } finally {
      this.abortController = null;
    }
  }

  /** Parses response text for <instruction> tag. */
  private parseResponse(responseText: string): InstructionRefineResult {
    const instructionMatch = responseText.match(/<instruction>([\s\S]*?)<\/instruction>/);
    if (instructionMatch) {
      return { success: true, refinedInstruction: instructionMatch[1].trim() };
    }

    // No instruction tag - treat as clarification question
    const trimmed = responseText.trim();
    if (trimmed) {
      return { success: true, clarification: trimmed };
    }

    return { success: false, error: 'Empty response' };
  }
}
