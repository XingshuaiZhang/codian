/**
 * Model type definitions and constants.
 */

/** Model identifier (string to support custom models via environment variables). */
export type CodexModel = string;

export const DEFAULT_CODEX_MODELS: { value: CodexModel; label: string; description: string }[] = [
  { value: 'gpt-5.4', label: 'GPT-5.4', description: 'Flagship model for complex reasoning and coding' },
  { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', description: 'Most capable current Codex model' },
  { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', description: 'Long-horizon coding model' },
  { value: 'gpt-5.2', label: 'GPT-5.2', description: 'Previous frontier GPT-5 model' },
];

export type ThinkingBudget = 'off' | 'low' | 'medium' | 'high' | 'xhigh';

export const THINKING_BUDGETS: { value: ThinkingBudget; label: string; tokens: number }[] = [
  { value: 'off', label: 'Off', tokens: 0 },
  { value: 'low', label: 'Low', tokens: 4000 },
  { value: 'medium', label: 'Med', tokens: 8000 },
  { value: 'high', label: 'High', tokens: 16000 },
  { value: 'xhigh', label: 'Ultra', tokens: 32000 },
];

/** Effort levels for adaptive thinking models. */
export type EffortLevel = 'low' | 'medium' | 'high' | 'max';

/** Codex CLI reasoning effort values supported by current model aliases. */
export type CodexReasoningEffort = 'low' | 'medium' | 'high';

export const EFFORT_LEVELS: { value: EffortLevel; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
];

export function toCodexReasoningEffort(effort: EffortLevel): CodexReasoningEffort {
  if (effort === 'max') {
    return 'high';
  }
  return effort;
}

/** Default effort level per model tier. */
export const DEFAULT_EFFORT_LEVEL: Record<string, EffortLevel> = Object.fromEntries(
  DEFAULT_CODEX_MODELS.map((model) => [model.value, 'high' as const])
);

/** Default thinking budget per model tier. */
export const DEFAULT_THINKING_BUDGET: Record<string, ThinkingBudget> = Object.fromEntries(
  DEFAULT_CODEX_MODELS.map((model) => [model.value, 'medium' as const])
);

const DEFAULT_MODEL_VALUES = new Set(DEFAULT_CODEX_MODELS.map(m => m.value));

/** Whether the model is a known Codex model that supports adaptive thinking. */
export function isAdaptiveThinkingModel(model: string): boolean {
  if (DEFAULT_MODEL_VALUES.has(model)) return true;
  return /^(gpt-5|gpt-5-codex|o4-mini|o3)/.test(model);
}

export function formatModelLabel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return 'Unknown';

  const basename = trimmed.includes('/')
    ? trimmed.split('/').pop() || trimmed
    : trimmed;

  if (/^gpt-\d+(\.\d+)?(?:-[a-z0-9.]+)*$/i.test(basename)) {
    const [family, version, ...suffixes] = basename.split('-');
    if (suffixes.length === 0) {
      return `${family.toUpperCase()}-${version}`;
    }

    return `${family.toUpperCase()}-${version} ${suffixes
      .map((suffix) => suffix[0].toUpperCase() + suffix.slice(1))
      .join(' ')}`;
  }

  return basename.replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

export const CONTEXT_WINDOW_STANDARD = 200_000;
export const CONTEXT_WINDOW_GPT5 = 400_000;
export const CONTEXT_WINDOW_GPT54 = 1_050_000;
export const CONTEXT_WINDOW_1M = 1_000_000;

export function filterVisibleModelOptions<T extends { value: string }>(
  models: T[],
  enableOpus1M: boolean,
  enableSonnet1M: boolean
): T[] {
  void enableOpus1M;
  void enableSonnet1M;
  return models;
}

export function normalizeVisibleModelVariant(
  model: string,
  enableOpus1M: boolean,
  enableSonnet1M: boolean
): string {
  void enableOpus1M;
  void enableSonnet1M;
  return model;
}

export function getContextWindowSize(
  model: string,
  customLimits?: Record<string, number>
): number {
  if (customLimits && model in customLimits) {
    const limit = customLimits[model];
    if (typeof limit === 'number' && limit > 0 && !isNaN(limit) && isFinite(limit)) {
      return limit;
    }
  }

  const normalized = model.trim().toLowerCase();
  if (normalized.includes('[') || normalized.includes(']')) {
    return CONTEXT_WINDOW_STANDARD;
  }

  if (
    normalized === 'gpt-5.4' ||
    normalized.startsWith('gpt-5.4-') ||
    normalized === 'gpt-5.4-pro' ||
    normalized.startsWith('gpt-5.4-pro-')
  ) {
    return CONTEXT_WINDOW_GPT54;
  }

  if (normalized.startsWith('gpt-5')) {
    return CONTEXT_WINDOW_GPT5;
  }

  return CONTEXT_WINDOW_STANDARD;
}
