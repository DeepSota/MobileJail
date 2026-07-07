import React from 'react';
import { IcClose, IcSend } from '../res/icons';
import { useXStore } from '../state';
import { useXConversations } from '../data/view';
import { useXGestures } from '../hooks/useXGestures';
import { useXStrings } from '../hooks/useXStrings';
import { XImage } from './XMedia';

interface XShareSheetProps {
  postId: string;
  onClose: () => void;
}

export const XShareSheet: React.FC<XShareSheetProps> = ({ postId, onClose }) => {
  const sendPostMessage = useXStore(s => s.sendPostMessage);
  const conversations = useXConversations();
  const { go } = useXGestures();
  const s = useXStrings();
  const [sent, setSent] = React.useState<string | null>(null);

  const handleSelect = (conversationId: string) => {
    sendPostMessage(conversationId, postId);
    setSent(conversationId);
    setTimeout(() => {
      onClose();
      go('messages.conversation.open', { id: conversationId });
    }, 500);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-app-bg w-full max-w-md rounded-t-2xl overflow-hidden animate-in slide-in-from-bottom-10 fade-in-0 duration-200 max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-app-border shrink-0">
          <span className="font-bold text-lg text-app-text">{s.share_send_via_dm}</span>
          <button onClick={onClose} className="p-1 rounded-full active:bg-gray-200">
            <IcClose size={20} className="text-app-text" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-2">
          {conversations.length === 0 ? (
            <div className="py-8 text-center text-gray-500">{s.share_no_conversations}</div>
          ) : (
            conversations.map(conv => {
              const participant = conv.participant;
              const isSent = sent === conv.id;
              return (
                <button
                  key={conv.id}
                  className="w-full flex items-center gap-3 p-3 rounded-xl active:bg-gray-100 transition-colors"
                  onClick={() => !isSent && handleSelect(conv.id)}
                  disabled={isSent}
                >
                  <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden shrink-0">
                    {participant?.avatar ? (
                      <XImage src={participant.avatar} alt={participant.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-blue-500 flex items-center justify-center text-white font-bold">
                        {participant?.name?.[0] ?? '?'}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="font-bold text-app-text text-sm truncate">{participant?.name ?? conv.participantId}</div>
                    <div className="text-gray-500 text-xs truncate">@{conv.participantId}</div>
                  </div>
                  {isSent ? (
                    <span className="text-green-500 text-xs font-bold">{s.share_sent}</span>
                  ) : (
                    <IcSend size={18} className="text-blue-400" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};