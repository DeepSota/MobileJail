import React, { useState } from 'react';
import { useEbayGestures, useEbayNavigation } from '../navigation';
import { useEbayStore, type EbayLoginResult } from '../state';
import { useEbayStrings } from '../hooks/useEbayStrings';
import { IcNavBack } from '../res/icons';

const errorKeyByReason: Record<Exclude<EbayLoginResult, { ok: true }>['reason'],
  | 'auth_error_missing_username'
  | 'auth_error_missing_password'
  | 'auth_error_no_account'
  | 'auth_error_wrong_password'> = {
  missing_username: 'auth_error_missing_username',
  missing_password: 'auth_error_missing_password',
  no_account: 'auth_error_no_account',
  wrong_password: 'auth_error_wrong_password',
};

const LoginPage: React.FC = () => {
  const s = useEbayStrings();
  const { back } = useEbayNavigation();
  const { bindAction, bindBack } = useEbayGestures();
  const login = useEbayStore(state => state.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorKey, setErrorKey] = useState<keyof typeof s | null>(null);
  const loginActionProps = bindAction('auth.login.submit');

  const handleLogin = (event: React.MouseEvent<HTMLButtonElement>) => {
    loginActionProps.onClick(event);
    const result = login(username, password);
    if (!result.ok) {
      setErrorKey(errorKeyByReason[result.reason]);
      return;
    }
    setErrorKey(null);
    back();
  };

  return (
    <div data-status-bar-foreground="dark" className="h-full bg-white flex flex-col">
      <header className="pt-10 h-[88px] px-4 flex items-center border-b border-gray-100">
        <button {...bindBack()} className="w-10 h-10 flex items-center justify-center" aria-label={s.settings_cancel}>
          <IcNavBack size={24} className="text-black" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-7 pt-10 pb-8" data-scroll-container="main" data-scroll-direction="vertical">
        <div className="text-[34px] font-bold tracking-normal mb-3" aria-label="eBay">
          <span className="text-[#e53238]">e</span>
          <span className="text-[#0064d2]">b</span>
          <span className="text-[#f5af02]">a</span>
          <span className="text-[#86b817]">y</span>
        </div>
        <h1 className="text-2xl font-bold text-black tracking-normal">{s.auth_login_title}</h1>
        <p className="mt-2 text-sm text-gray-600 tracking-normal">{s.auth_login_subtitle}</p>

        <div className="mt-8 space-y-5">
          <label className="block">
            <span className="block text-sm font-medium text-gray-800 mb-2">{s.auth_username_label}</span>
            <input
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setErrorKey(null);
              }}
              autoCapitalize="none"
              autoComplete="username"
              placeholder={s.auth_username_placeholder}
              className="w-full h-12 px-3 border border-gray-400 rounded-md text-base text-black outline-none focus:border-[#0064d2]"
            />
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-gray-800 mb-2">{s.auth_password_label}</span>
            <input
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setErrorKey(null);
              }}
              type="password"
              autoComplete="current-password"
              placeholder={s.auth_password_placeholder}
              className="w-full h-12 px-3 border border-gray-400 rounded-md text-base text-black outline-none focus:border-[#0064d2]"
            />
          </label>
        </div>

        <div className="min-h-10 pt-3 text-sm text-red-600" role="alert">
          {errorKey ? s[errorKey] : null}
        </div>

        <button
          {...loginActionProps}
          onClick={handleLogin}
          data-keep-keyboard="true"
          className="w-full h-12 rounded-full bg-[#3665f3] text-white text-base font-semibold disabled:bg-gray-300"
        >
          {s.auth_submit}
        </button>
      </main>
    </div>
  );
};

export default LoginPage;
