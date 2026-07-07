import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { IcNavBack } from '../../res/icons';
import * as TimeService from '../../../../os/TimeService';
import { useWechatGestures } from '../../hooks/useWechatGestures';
import { useWechatStore } from '../../state';
import { BackDispatcher } from '../../../../os/BackDispatcher';
import { useWechatStrings } from '../../hooks/useWechatStrings';

export const TransferConfirmPage: React.FC = () => {
  const { bindBack, bindTap, back } = useWechatGestures();
  const { id: targetWxid } = useParams<{ id: string }>();
  const location = useLocation();
  const t = useWechatStrings();

  const transferMoney = useWechatStore(s => s.transferMoney);
  const balance = useWechatStore(s => s.balance ?? 0);
  const { contacts, currentUserWxid } = useWechatStore(useShallow(s => ({
    contacts: s.contacts,
    currentUserWxid: s.user.wxid,
  })));

  const target = contacts.find(c => c.wxid === targetWxid);
  const targetName = target?.name ?? targetWxid ?? '';

  // Read amount and note from location state (passed from TransferPage)
  const state = location.state as { amount?: number; note?: string } | null;
  const amount = state?.amount ?? 0;
  const note = state?.note ?? '';

  const [paying, setPaying] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');

  const payingRef = useRef(false);
  payingRef.current = paying;

  useEffect(() => {
    return BackDispatcher.register('wechat.transferConfirm.back', () => {
      if (payingRef.current) return true;
      if (showPassword) {
        setShowPassword(false);
        setPassword('');
        return true;
      }
      return false;
    }, 150);
  }, [showPassword]);

  const handlePay = () => {
    setShowPassword(true);
  };

  const onPasswordComplete = () => {
    setPaying(true);
    setShowPassword(false);
    setTimeout(() => {
      if (targetWxid && amount > 0) {
        transferMoney(targetWxid, amount, note);
      }
      // Navigate back to chat (pop 2 pages: confirm + transfer)
      back(2);
    }, 1000);
  };

  const handlePasswordInput = (num: string) => {
    if (password.length < 6) {
      const next = password + num;
      setPassword(next);
      if (next.length === 6) {
        setTimeout(onPasswordComplete, 300);
      }
    }
  };

  const handlePasswordDelete = () => {
    setPassword(p => p.slice(0, -1));
  };

  return (
    <div className="bg-white h-full flex flex-col font-sans pt-10">
      <div className="flex items-center px-4 h-12 border-b border-gray-100 relative">
        <button {...bindBack<HTMLButtonElement>()} className="absolute left-4">
          <IcNavBack size={24} />
        </button>
        <div className="flex-1 text-center font-medium text-[17px]">{t.transfer_confirm_title}</div>
      </div>

      <div className="flex-1 flex flex-col items-center pt-12 px-8">
        <div className="text-[15px] text-gray-500 mb-2">{targetName}</div>
        <div className="text-[40px] font-bold mb-12 flex items-baseline">
          <span className="text-2xl mr-1">¥</span>
          {amount.toFixed(2)}
        </div>

        {note && (
          <div className="w-full text-[14px] text-gray-500 mb-6 text-center">
            {note}
          </div>
        )}

        <div className="w-full space-y-6">
          <div className="flex justify-between text-[15px]">
            <span className="text-gray-500">{t.transfer_pay_method}</span>
            <span>{t.transfer_balance_label} ¥{balance.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="p-8 pb-safe">
        <button
          className="w-full bg-[#07c160] text-white font-bold py-3 rounded-lg text-[17px] active:bg-[#06ad56] transition-colors"
          disabled={paying}
          {...bindTap<HTMLButtonElement>({ kind: 'action', id: 'wechat.transfer.confirm' }, { onTrigger: handlePay })}
        >
          {paying ? '转账中' : t.transfer_button}
        </button>
      </div>

      {showPassword && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => { setShowPassword(false); setPassword(''); }} />
          <div className="bg-white rounded-t-xl animate-slide-up relative z-10 w-full pb-safe">
            <div className="flex justify-between items-center p-4 border-b border-gray-100">
              <button
                className="text-gray-400 text-2xl leading-none"
                {...bindTap<HTMLButtonElement>({ kind: 'action', id: 'wechat.transfer.pwd.cancel' }, { onTrigger: () => { setShowPassword(false); setPassword(''); } })}
              >
                ×
              </button>
              <span className="text-[17px] font-bold">{t.transfer_enter_password}</span>
              <div className="w-6" />
            </div>

            <div className="py-8 flex justify-center">
              <div className="flex border border-gray-300 rounded overflow-hidden">
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="w-12 h-12 border-r border-gray-300 last:border-r-0 flex items-center justify-center">
                    {password.length > i && <div className="w-2 h-2 bg-black rounded-full" />}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#f2f2f2] grid grid-cols-3 gap-[1px]">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                <button
                  key={n}
                  className="bg-white py-4 text-2xl font-medium active:bg-gray-200"
                  {...bindTap<HTMLButtonElement>({ kind: 'action', id: `wechat.pay.num.${n}` as any }, { onTrigger: () => handlePasswordInput(n.toString()) })}
                >
                  {n}
                </button>
              ))}
              <div className="bg-[#f2f2f2]" />
              <button
                className="bg-white py-4 text-2xl font-medium active:bg-gray-200"
                {...bindTap<HTMLButtonElement>({ kind: 'action', id: 'wechat.pay.num.0' }, { onTrigger: () => handlePasswordInput('0') })}
              >
                0
              </button>
              <button
                className="bg-white py-4 flex items-center justify-center active:bg-gray-200"
                {...bindTap<HTMLButtonElement>({ kind: 'action', id: 'wechat.pay.delete' }, { onTrigger: handlePasswordDelete })}
              >
                <span className="text-lg">☒</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TransferConfirmPage;