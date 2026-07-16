import { beforeEach, describe, expect, it, vi } from 'vitest';

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

describe('eBay 登录状态', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'localStorage', {
      value: createLocalStorageMock(),
      configurable: true,
    });
  });

  it('只有凭据匹配时才建立登录会话', async () => {
    const { useEbayStore } = await import('../apps/Ebay/state');
    useEbayStore.setState({
      auth: {
        accounts: [{ username: 'zhangwei', password: '872456', displayName: '张伟' }],
      },
      user: { name: 'User', username: null, isLoggedIn: false },
    });

    expect(useEbayStore.getState().login('zhangwei', 'wrong-password')).toEqual({
      ok: false,
      reason: 'wrong_password',
    });
    expect(useEbayStore.getState().user).toEqual({
      name: 'User',
      username: null,
      isLoggedIn: false,
    });

    expect(useEbayStore.getState().login('zhangwei', '872456')).toEqual({ ok: true });
    expect(useEbayStore.getState().user).toEqual({
      name: '张伟',
      username: 'zhangwei',
      isLoggedIn: true,
    });
  });

  it('退出登录后清空当前账号', async () => {
    const { useEbayStore } = await import('../apps/Ebay/state');
    useEbayStore.setState({
      user: { name: '张伟', username: 'zhangwei', isLoggedIn: true },
    });

    useEbayStore.getState().logout();

    expect(useEbayStore.getState().user).toEqual({
      name: 'User',
      username: null,
      isLoggedIn: false,
    });
  });
});
