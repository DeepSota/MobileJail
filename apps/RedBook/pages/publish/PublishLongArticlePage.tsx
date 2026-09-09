import { useRedBookStrings } from '../../hooks/useRedBookStrings';
import React, { useEffect, useState } from 'react';
import { IcNavBack } from '../../res/icons';
const ChevronLeft = IcNavBack;
import { useRedBookStore } from '../../state';
import { useShallow } from 'zustand/react/shallow';
import { useRedBookGestures } from '../../hooks/useRedBookGestures';
export const PublishLongArticlePage: React.FC = () => {
  const s = useRedBookStrings();
  const { publishDraft, updatePublishDraft, addNote, resetPublishDraft } = useRedBookStore(useShallow(s => ({
    publishDraft: s.publishDraft,
    updatePublishDraft: s.updatePublishDraft,
    addNote: s.addNote,
    resetPublishDraft: s.resetPublishDraft,
  })));
  const { bindTap, bindBack, back } = useRedBookGestures();
  const [title, setTitle] = useState(publishDraft.title || '');
  const [content, setContent] = useState(publishDraft.text || '');

  useEffect(() => {
    updatePublishDraft({ title, text: content });
  }, [title, content, updatePublishDraft]);

  const handlePublish = () => {
    if (!title.trim() && !content.trim()) return;
    addNote({
      title: title.trim(),
      content: content.trim(),
      images: [],
    });
    resetPublishDraft();
    back(2);
  };

  return (
    <div className="h-full w-full bg-app-surface flex flex-col">
      {/* Header */}
      <div className="pt-10 px-4 pb-3 flex items-center justify-between">
        <button className="w-8 h-8 flex items-center justify-start" {...bindBack()}>
          <ChevronLeft size={24} className="text-[#111]" />
        </button>
        <div className="text-[17px] font-medium text-[#111]">{s.write_long_post}</div>
        <button
          className={`px-4 py-1.5 rounded-full text-[13px] font-medium ${
            (title.trim() || content.trim()) ? 'bg-app-primary text-white' : 'bg-[#f0f0f0] text-[#bbb]'
          }`}
          {...((title.trim() || content.trim()) ? bindTap({ kind: 'action', id: 'publish.longarticle.submit' }, { onTrigger: handlePublish }) : {})}
        >
          {s.publish_note}
        </button>
      </div>

      {/* Editor */}
      <div
        className="flex-1 px-4 overflow-y-auto"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        {/* Title input */}
        <input
          className="w-full text-[22px] font-bold text-app-text placeholder-[#cfcfcf] outline-none py-3 border-b border-gray-100"
          placeholder={s.add_title}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        {/* Body textarea */}
        <textarea
          className="w-full min-h-[400px] text-[16px] text-[#333] leading-relaxed outline-none resize-none py-3"
          placeholder={s.say_something_or_ask_a_question}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>
    </div>
  );
};

export default PublishLongArticlePage;