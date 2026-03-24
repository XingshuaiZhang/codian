import {
  findUnsupportedCodexAuthEnvironmentKeys,
  omitUnsupportedCodexAuthEnvironmentVariables,
  sanitizeUnsupportedCodexAuthEnvironmentText,
} from '../../../src/utils/codexConfig';

describe('findUnsupportedCodexAuthEnvironmentKeys', () => {
  it('finds unsupported auth variables when present', () => {
    expect(findUnsupportedCodexAuthEnvironmentKeys({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: 'https://proxy.example.com/v1',
      OTHER_VAR: 'value',
    })).toEqual([
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
    ]);
  });

  it('returns an empty list when none are present', () => {
    expect(findUnsupportedCodexAuthEnvironmentKeys({
      HTTP_PROXY: 'http://127.0.0.1:7890',
    })).toEqual([]);
  });
});

describe('omitUnsupportedCodexAuthEnvironmentVariables', () => {
  it('removes unsupported auth environment variables and preserves others', () => {
    expect(omitUnsupportedCodexAuthEnvironmentVariables({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: 'https://proxy.example.com/v1',
      openai_base_url: 'https://proxy.example.com/v1',
      HTTP_PROXY: 'http://127.0.0.1:7890',
    })).toEqual({
      HTTP_PROXY: 'http://127.0.0.1:7890',
    });
  });
});

describe('sanitizeUnsupportedCodexAuthEnvironmentText', () => {
  it('removes unsupported auth lines from saved environment text', () => {
    expect(sanitizeUnsupportedCodexAuthEnvironmentText([
      'OPENAI_API_KEY=sk-test',
      'HTTP_PROXY=http://127.0.0.1:7890',
      'export OPENAI_BASE_URL=https://proxy.example.com/v1',
      'CODEX_HOME=~/.codex',
    ].join('\n'))).toEqual({
      envText: [
        'HTTP_PROXY=http://127.0.0.1:7890',
        'CODEX_HOME=~/.codex',
      ].join('\n'),
      removedKeys: [
        'OPENAI_API_KEY',
        'OPENAI_BASE_URL',
      ],
    });
  });
});
