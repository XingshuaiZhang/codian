import { DEFAULT_CODEX_MODELS } from '@/core/types';
import {
  clearModelCatalogCache,
  getModelCatalogSnapshot,
  isModelCatalogRefreshNeeded,
  refreshModelCatalog,
} from '@/utils/modelCatalog';

describe('modelCatalog', () => {
  beforeEach(() => {
    clearModelCatalogCache();
  });

  it('always returns the fixed manual catalog', async () => {
    const snapshot = getModelCatalogSnapshot('', 'gpt-5.4');
    const refreshed = await refreshModelCatalog(
      'OPENAI_API_KEY=sk-test\nOPENAI_BASE_URL=https://proxy.example.com/v1',
      'custom/provider-model'
    );

    expect(snapshot.mode).toBe('fixed');
    expect(snapshot.source).toBe('fixed');
    expect(snapshot.models.map((model) => model.value)).toEqual(DEFAULT_CODEX_MODELS.map((model) => model.value));
    expect(refreshed.mode).toBe('fixed');
    expect(refreshed.models.map((model) => model.value)).toEqual(DEFAULT_CODEX_MODELS.map((model) => model.value));
  });

  it('never requires a remote refresh', () => {
    expect(isModelCatalogRefreshNeeded('')).toBe(false);
    expect(isModelCatalogRefreshNeeded('OPENAI_API_KEY=sk-test')).toBe(false);
  });
});
