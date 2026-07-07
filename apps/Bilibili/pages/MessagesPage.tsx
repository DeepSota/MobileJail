import React from 'react';
import { useBilibiliStore } from '../state';
import { useBilibiliGestures } from '../hooks/useBilibiliGestures';
import { IcNavBack } from '../res/icons';
import * as TimeService from '../../../os/TimeService';
import { resolveBilibiliDisplayName } from '../utils/resolveDisplayName';
import { useAuthors } from '../hooks/useData';

export const MessagesPage: React.FC = () => {
  const chats = useBilibiliStore(s => s.chats);
  const user = useBilibiliStore(s => s.user);
  const { bindTap, bindBack } = useBilibiliGestures();
  const authors = useAuthors();

  const resolveName = (userId: string, username: string) =>
    resolveBilibiliDisplayName(userId, user, username, undefined, authors);

  return (
    <div className="flex flex-col h-full bg-app-surface">
      <div className="pt-10 px-4 pb-3 flex items-center border-b border-gray-100">
        <button className="w-8 h-8 flex items-center justify-start" {...bindBack()}>
          <IcNavBack size={24} className="text-app-text" />
        </button>
        <div className="flex-1 text-center text-[17px] font-medium text-app-text">私信</div>
        <div className="w-8" />
      </div>

      <div className="flex-1 overflow-y-auto" data-scroll-container="main" data-scroll-direction="vertical">
        {chats.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm">
            暂无私信
          </div>
        ) : (
          chats.map(chat => (
            <div
              key={chat.userId}
              {...bindTap('chat.open', { params: { userId: chat.userId } })}
              className="flex items-center gap-3 px-4 py-3 active:bg-gray-50 border-b border-gray-50"
            >
              <img
                src={chat.avatar}
                alt=""
                className="w-11 h-11 rounded-full bg-gray-200 object-cover flex-shrink-0"
                onError={(e) => { (e.currentTarget.style.display = 'none'); }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-medium text-app-text truncate">{resolveName(chat.userId, chat.username)}</div>
                <div className="text-[13px] text-gray-400 truncate">{chat.lastMessage || ''}</div>
              </div>
              {chat.lastTime ? (
                <div className="text-[11px] text-gray-400 flex-shrink-0">
                  {(() => {
                    const d = TimeService.fromTimestamp(chat.lastTime);
                    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
                  })()}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default MessagesPage;