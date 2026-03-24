const UNSUPPORTED_CODEX_AUTH_ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'openai_base_url',
] as const;

function getNormalizedEnvKey(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const normalized = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed;
  const eqIndex = normalized.indexOf('=');
  if (eqIndex <= 0) {
    return null;
  }

  const key = normalized.substring(0, eqIndex).trim();
  return key || null;
}

export function findUnsupportedCodexAuthEnvironmentKeys(envVars: Record<string, string>): string[] {
  return UNSUPPORTED_CODEX_AUTH_ENV_KEYS.filter((key) => {
    const value = envVars[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

export function omitUnsupportedCodexAuthEnvironmentVariables<T extends Record<string, string | undefined>>(input: T): T {
  const sanitized = { ...input } as T;
  const mutable = sanitized as Record<string, string | undefined>;

  for (const key of UNSUPPORTED_CODEX_AUTH_ENV_KEYS) {
    delete mutable[key];
  }

  return sanitized;
}

export function sanitizeUnsupportedCodexAuthEnvironmentText(input: string): {
  envText: string;
  removedKeys: string[];
} {
  const removedKeys = new Set<string>();
  const keptLines: string[] = [];

  for (const line of input.split(/\r?\n/)) {
    const key = getNormalizedEnvKey(line);
    if (key && UNSUPPORTED_CODEX_AUTH_ENV_KEYS.includes(key as typeof UNSUPPORTED_CODEX_AUTH_ENV_KEYS[number])) {
      removedKeys.add(key);
      continue;
    }

    keptLines.push(line);
  }

  return {
    envText: keptLines.join('\n'),
    removedKeys: Array.from(removedKeys),
  };
}
