import { afterEach, expect, it, vi } from 'vitest';
import type { Account } from './account';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: {
  rpc,
  auth: { getSession: async () => ({ data: { session: { user: { id: 'player' }, access_token: 'test-token' } } }) },
} }));
vi.mock('../progress', () => ({ allRecords: () => ({}), guestRecords: () => ({}), mergeRecords: () => 0, setOnRecord: () => {}, setProgressUser: () => {} }));
import { RecordSync } from './records';

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

it('retains an unsent batch when the server rejects it at the account quota', async () => {
  vi.stubGlobal('window', { addEventListener: () => {} });
  const key = 'avoid-n-survive:pending-records:player';
  const records = Object.fromEntries(Array.from({ length: 2001 }, (_, i) =>
    [`custom:pack${Math.floor(i / 999)}/${i % 999}`, { best: 100, stars: 1 }]));
  const saved = new Map([[key, JSON.stringify(records)]]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, value: string) => saved.set(k, value),
    removeItem: (k: string) => saved.delete(k),
  });
  rpc.mockReturnValueOnce({ setHeader: () => Promise.resolve({ error: null }) })
    .mockReturnValueOnce({ setHeader: () => Promise.resolve({ error: { message: 'RECORD_QUOTA_EXCEEDED' } }) });
  new RecordSync({ profile: {}, user: { id: 'player' }, onChange: () => {} } as unknown as Account);
  await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
  expect(rpc.mock.calls[0][1].p_records).toHaveLength(2000);
  expect(rpc.mock.calls[1][1].p_records).toHaveLength(1);
  expect(Object.keys(JSON.parse(saved.get(key)!))).toEqual([Object.keys(records)[2000]]);
});
