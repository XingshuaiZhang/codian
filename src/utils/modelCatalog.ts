import type { CodexModel } from '../core/types';
import { DEFAULT_CODEX_MODELS } from '../core/types/models';

export interface ModelOption {
  value: CodexModel;
  label: string;
  description: string;
}

export interface ModelCatalog {
  mode: 'fixed';
  models: ModelOption[];
  source: 'fixed';
  signature: string;
}

function cloneDefaultModels(): ModelOption[] {
  return DEFAULT_CODEX_MODELS.map((model) => ({ ...model }));
}

export function clearModelCatalogCache(): void {
  // Static catalog only; nothing to clear.
}

export function getModelCatalogSnapshot(_envText: string, _currentModel?: string): ModelCatalog {
  return {
    mode: 'fixed',
    models: cloneDefaultModels(),
    source: 'fixed',
    signature: 'fixed',
  };
}

export function isModelCatalogRefreshNeeded(_envText: string): boolean {
  return false;
}

export async function refreshModelCatalog(envText: string, currentModel?: string): Promise<ModelCatalog> {
  return getModelCatalogSnapshot(envText, currentModel);
}
