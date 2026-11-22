import { nextOffset, processUpdates, scrubDevEnv, waitForJob } from '../../scripts/lib/dev-logic.js';

const upd = (id: number) => ({ update_id: id }) as never;

describe('scrubDevEnv', () => {
  it('removes the public URL variables and keeps the rest', () => {
    const out = scrubDevEnv({ A: '1', PUBLIC_BASE_URL: 'https://x', VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' });
    expect(out).toEqual({ A: '1' });
  });
});

describe('nextOffset', () => {
  it('stays undefined with no updates and no offset', () => {
    expect(nextOffset(undefined, [])).toBeUndefined();
  });
  it('keeps the current offset when nothing new arrived', () => {
    expect(nextOffset(10, [])).toBe(10);
  });
  it('is the highest update_id + 1, whatever the order', () => {
    expect(nextOffset(undefined, [upd(5), upd(9), upd(7)])).toBe(10);
  });
  it('never goes backwards', () => {
    expect(nextOffset(20, [upd(5)])).toBe(20);
  });
});

describe('waitForJob', () => {
  const base = () => {
    let t = 0;
    return {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
      signal: new AbortController().signal,
      onError: vi.fn(),
    };
  };

  it('returns once the job is completed', async () => {
    const statuses = ['queued', 'processing', 'completed'];
    const out = await waitForJob({ ...base(), getStatus: async () => statuses.shift() ?? null });
    expect(out).toBe('completed');
    expect(statuses).toEqual([]);
  });

  it('returns error for a failed job', async () => {
    expect(await waitForJob({ ...base(), getStatus: async () => 'error' })).toBe('error');
  });

  it('reports a failed lookup and keeps polling', async () => {
    const b = base();
    let calls = 0;
    const out = await waitForJob({
      ...b,
      getStatus: async () => {
        if (++calls === 1) throw new Error('blip');
        return 'completed';
      },
    });
    expect(out).toBe('completed');
    expect(b.onError).toHaveBeenCalledTimes(1);
  });

  it('gives up after the deadline', async () => {
    const out = await waitForJob({ ...base(), getStatus: async () => 'processing', giveUpMs: 10_000 });
    expect(out).toBe('gave_up');
  });

  it('stops when the signal aborts', async () => {
    const ctl = new AbortController();
    const b = base();
    const out = await waitForJob({
      ...b,
      signal: ctl.signal,
      getStatus: async () => {
        ctl.abort();
        return 'processing';
      },
    });
    expect(out).toBe('stopped');
  });
});

describe('processUpdates', () => {
  it('advances the offset after each handled update', async () => {
    const state = { offset: undefined as number | undefined, processed: 0 };
    const seen: (number | undefined)[] = [];
    await processUpdates([upd(5), upd(6)], state, async () => {
      seen.push(state.offset);
    });
    expect(seen).toEqual([undefined, 6]);
    expect(state).toEqual({ offset: 7, processed: 2 });
  });

  it('keeps the progress made before a handler throws', async () => {
    const state = { offset: undefined as number | undefined, processed: 0 };
    let n = 0;
    await expect(
      processUpdates([upd(5), upd(6), upd(7)], state, async () => {
        if (++n === 2) throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(state).toEqual({ offset: 6, processed: 1 });
  });
});

describe('waitForJob when the job is gone', () => {
  it('ends immediately with "missing" when getStatus returns null', async () => {
    let t = 0;
    const sleep = vi.fn(async (ms: number) => {
      t += ms;
    });
    const out = await waitForJob({
      getStatus: async () => null,
      sleep,
      now: () => t,
      signal: new AbortController().signal,
      onError: vi.fn(),
    });
    expect(out).toBe('missing');
    expect(sleep).not.toHaveBeenCalled();
  });
});
