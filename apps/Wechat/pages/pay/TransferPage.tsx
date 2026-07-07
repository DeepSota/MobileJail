import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { IcNavBack } from '../../res/icons';
import { useWechatStore } from '../../state';
import { useWechatGestures } from '../../hooks/useWechatGestures';
import { useWechatStrings } from '../../hooks/useWechatStrings';

export const TransferPage: React.FC = () => {
  const { bindBack, bindTap, go } = useWechatGestures();
  const { id: targetWxid } = useParams<{ id: string }>();
  const t = useWechatStrings();

  const { balance, contacts, currentUserWxid } = useWechatStore(useShallow(s => ({
    balance: s.balance ?? 0,
    contacts: s.contacts,
    currentUserWxid: s.user.wxid,
  })));

  const target = contacts.find(c => c.wxid === targetWxid);
  const targetName = target?.name ?? targetWxid ?? '';
  const targetAvatar = target?.avatar ?? '';

  const [amountStr, setAmountStr] = useState('');
  const [note, setNote] = useState('');
  const amount = parseFloat(amountStr) || 0;
  const canTransfer = amount > 0 && amount <= balance;

  const handleNum = (n: string) => {
    setAmountStr(prev => {
      const next = prev + n;
      // Prevent more than 2 decimal places
      const dotIndex = next.indexOf('.');
      if (dotIndex !== -1 && next.length - dotIndex - 1 > 2) return prev;
      // Prevent leading zeros
      if (next.length > 1 && next[0] === '0' && next[1] !== '.') return next.slice(1);
      return next;
    });
  };

  const handleDelete = () => {
    setAmountStr(prev => prev.slice(0, -1));
  };

  const handleDot = () => {
    setAmountStr(prev => {
      if (prev.includes('.')) return prev;
      if (prev === '') return '0.';
      return prev + '.';
    });
  };

  return (
    <div className="h-full w-full flex flex-col bg-app-bg" data-status-bar-foreground="dark">
      {/* Top bar */}
      <div className="pt-10 flex items-center px-2 h-[88px] shrink-0 bg-app-bg border-b border-app-border">
        <button
          type="button"
          className="w-10 h-10 flex items-center justify-center active:opacity-60"
          {...bindBack<HTMLButtonElement>()}
        >
          <IcNavBack size={26} className="text-app-text" />
        </button>
        <div className="flex-1 text-center text-[17px] font-medium text-app-text">{t.transfer_title}</div>
        <div className="w-10 h-10" />
      </div>

      {/* Recipient info */}
      <div className="flex items-center gap-3 px-6 py-5 bg-app-surface">
        <img
          src={targetAvatar}
          alt={targetName}
          className="w-12 h-12 rounded-[6px] object-cover bg-(--app-c-tw-bg-gray-100)"
        />
        <div>
          <div className="text-[15px] text-app-text">{targetName}</div>
        </div>
      </div>

      {/* Amount display */}
      <div className="px-6 py-8 bg-app-surface mt-2">
        <div className="flex items-baseline gap-1">
          <span className="text-[28px] font-light text-app-text">¥</span>
          <span className={`text-[48px] font-light ${amountStr ? 'text-app-text' : 'text-(--app-c-tw-text-gray-300)'}`}>
            {amountStr || t.transfer_amount_placeholder}
          </span>
        </div>
      </div>

      {/* Note input */}
      <div className="px-6 py-3 bg-app-surface mt-2 flex items-center gap-2">
        <span className="text-[14px] text-(--app-c-tw-text-gray-400) shrink-0">{t.transfer_note_label}</span>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={t.transfer_note_placeholder}
          maxLength={25}
          className="flex-1 bg-transparent outline-none text-[14px] text-app-text placeholder:text-(--app-c-tw-text-gray-400)"
        />
      </div>

      {/* Balance info */}
      <div className="px-6 py-2 flex items-center justify-between">
        <span className="text-[12px] text-(--app-c-tw-text-gray-400)">
          {t.transfer_balance_label}：¥{balance.toFixed(2)}
        </span>
        {amount > balance && (
          <span className="text-[12px] text-red-500">{t.transfer_balance_insufficient}</span>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Transfer button */}
      <div className="px-6 pb-8 pt-4">
        <button
          type="button"
          disabled={!canTransfer}
          onClick={() => {
            if (canTransfer && targetWxid) {
              go('chat.transfer.confirm.open', { id: targetWxid }, { state: { amount, note } });
            }
          }}
          className={`w-full h-12 rounded-[8px] text-[17px] font-medium ${
            canTransfer
              ? 'bg-app-primary text-white active:bg-app-primary-dark'
              : 'bg-(--app-c-search-result-divider) text-(--app-c-tw-text-gray-400)'
          }`}
        >
          {t.transfer_button}
        </button>
      </div>

      {/* Numeric keypad */}
      <div className="bg-[#f2f2f2] grid grid-cols-3 gap-[1px] pb-safe">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
          <button
            key={n}
            type="button"
            className="bg-white py-4 text-2xl font-medium active:bg-gray-200"
            onClick={() => handleNum(n.toString())}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          className="bg-white py-4 text-2xl font-medium active:bg-gray-200"
          onClick={handleDot}
        >
          .
        </button>
        <button
          type="button"
          className="bg-white py-4 text-2xl font-medium active:bg-gray-200"
          onClick={() => handleNum('0')}
        >
          0
        </button>
        <button
          type="button"
          className="bg-white py-4 flex items-center justify-center active:bg-gray-200"
          onClick={handleDelete}
        >
          <span className="text-lg">☒</span>
        </button>
      </div>
    </div>
  );
};

export default TransferPage;