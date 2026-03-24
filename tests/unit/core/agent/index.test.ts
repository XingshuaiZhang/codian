import { CodianService, MessageChannel, QueryOptionsBuilder, SessionManager } from '@/core/agent';

describe('core/agent index', () => {
  it('re-exports runtime symbols', () => {
    expect(CodianService).toBeDefined();
    expect(MessageChannel).toBeDefined();
    expect(QueryOptionsBuilder).toBeDefined();
    expect(SessionManager).toBeDefined();
  });
});

