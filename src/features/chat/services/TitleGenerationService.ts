import { TITLE_GENERATION_SYSTEM_PROMPT } from '../../../core/prompts/titleGeneration';
import type CodianPlugin from '../../../main';
import { runCodexText } from '../../../utils/codexCli';

export type TitleGenerationResult =
  | { success: true; title: string }
  | { success: false; error: string };

export type TitleGenerationCallback = (
  conversationId: string,
  result: TitleGenerationResult
) => Promise<void>;

export class TitleGenerationService {
  private plugin: CodianPlugin;
  private activeGenerations: Map<string, AbortController> = new Map();

  constructor(plugin: CodianPlugin) {
    this.plugin = plugin;
  }

  /**
   * Generates a title for a conversation based on the first user message.
   * Non-blocking: calls callback when complete.
   */
  async generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback
  ): Promise<void> {
    if (!this.plugin.getResolvedCodexCliPath()) {
      await this.safeCallback(callback, conversationId, {
        success: false,
        error: 'Codex CLI not found',
      });
      return;
    }

    // Cancel any existing generation for this conversation
    const existingController = this.activeGenerations.get(conversationId);
    if (existingController) {
      existingController.abort();
    }

    // Create a new local AbortController for this generation
    const abortController = new AbortController();
    this.activeGenerations.set(conversationId, abortController);

    // Truncate message if too long (save tokens)
    const truncatedUser = this.truncateText(userMessage, 500);

    const prompt = `User's request:
"""
${truncatedUser}
"""

Generate a title for this conversation:`;

    try {
      const response = await runCodexText({
        plugin: this.plugin,
        prompt: [
          `<system_instructions>`,
          TITLE_GENERATION_SYSTEM_PROMPT,
          `</system_instructions>`,
          '',
          prompt,
        ].join('\n'),
        model: this.plugin.settings.titleGenerationModel || undefined,
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        ephemeral: true,
        signal: abortController.signal,
      });

      const title = this.parseTitle(response.text);
      if (title) {
        await this.safeCallback(callback, conversationId, { success: true, title });
      } else {
        await this.safeCallback(callback, conversationId, {
          success: false,
          error: 'Failed to parse title from response',
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      await this.safeCallback(callback, conversationId, { success: false, error: msg });
    } finally {
      // Clean up the controller for this conversation
      this.activeGenerations.delete(conversationId);
    }
  }

  /** Cancels all ongoing title generations. */
  cancel(): void {
    for (const controller of this.activeGenerations.values()) {
      controller.abort();
    }
    this.activeGenerations.clear();
  }

  /** Truncates text to a maximum length with ellipsis. */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  /** Parses and cleans the title from response. */
  private parseTitle(responseText: string): string | null {
    const trimmed = responseText.trim();
    if (!trimmed) return null;

    // Remove surrounding quotes if present
    let title = trimmed;
    if (
      (title.startsWith('"') && title.endsWith('"')) ||
      (title.startsWith("'") && title.endsWith("'"))
    ) {
      title = title.slice(1, -1);
    }

    // Remove trailing punctuation
    title = title.replace(/[.!?:;,]+$/, '');

    // Truncate to max 50 characters
    if (title.length > 50) {
      title = title.substring(0, 47) + '...';
    }

    return title || null;
  }

  /** Safely invokes callback with try-catch to prevent unhandled errors. */
  private async safeCallback(
    callback: TitleGenerationCallback,
    conversationId: string,
    result: TitleGenerationResult
  ): Promise<void> {
    try {
      await callback(conversationId, result);
    } catch {
      // Silently ignore callback errors
    }
  }
}
