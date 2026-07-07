import { useRedBookStrings } from '../../hooks/useRedBookStrings';
import React, { useState } from 'react';
import { IcNavBack } from '../../res/icons';
const ChevronLeft = IcNavBack;
import { useRedBookStore } from '../../state';
import { useShallow } from 'zustand/react/shallow';
import { useRedBookGestures } from '../../hooks/useRedBookGestures';

export const PublishPhotoFinalPage: React.FC = () => {
  const s = useRedBookStrings();
  const { publishDraft, updatePublishDraft, addNote, resetPublishDraft } = useRedBookStore(useShallow(s => ({
    publishDraft: s.publishDraft,
    updatePublishDraft: s.updatePublishDraft,
    addNote: s.addNote,
    resetPublishDraft: s.resetPublishDraft,
  })));
  const { bindTap, bindBack, back } = useRedBookGestures();
  const [title, setTitle] = useState(publishDraft.title || '');

  const handlePublish = () => {
    addNote({
      title: title.trim(),
      content: '',
      images: publishDraft.images,
    });
    resetPublishDraft();
    back(1);
  };

  const handleSaveDraft = () => {
    updatePublishDraft({ text: '', title });
    back();
  };

  const images = publishDraft.images || [];

  return (
    <div className="h-full flex flex-col bg-app-surface">
      <div className="pt-10 px-4 pb-3 flex items-center justify-between">
        <button className="w-8 h-8 flex items-center justify-start" {...bindBack()}>
          <ChevronLeft size={24} className="text-[#111]" />
        </button>
        <div className="text-[17px] font-medium text-[#111]">{s.publish_note}</div>
        <div className="w-12" />
      </div>

      <div
        className="flex-1 overflow-y-auto px-4"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        <div className="flex flex-wrap gap-2 mt-2">
          {images.map((img, idx) => (
            <img
              key={idx}
              src={img}
              alt=""
              className="w-[72px] h-[72px] rounded-[10px] shadow-sm object-cover bg-gray-100"
            />
          ))}
        </div>

        <div className="mt-6 text-[16px] text-[#ccc]">
          <input
            className="w-full text-[18px] text-app-text placeholder-[#cfcfcf] outline-none"
            placeholder={s.add_title}
            value={title}
            onChange={(e) => {
              const next = e.target.value;
              setTitle(next);
              updatePublishDraft({ title: next });
            }}
          />
        </div>
      </div>

      <div className="px-4 pb-8 pt-4 flex items-center gap-4">
        <button
          className="flex-1 h-[44px] border border-app-primary text-app-primary rounded-full text-[15px]"
          {...bindBack({ onTrigger: handleSaveDraft })}
        >
          {s.save_draft}
        </button>
        <button
          className="flex-[2] h-[44px] bg-app-primary text-white rounded-full text-[16px] font-medium"
          {...bindTap({ kind: 'action', id: 'publish.photo.submit' }, { onTrigger: handlePublish })}
        >
          {s.publish_note}
        </button>
      </div>
    </div>
  );
};

export default PublishPhotoFinalPage;