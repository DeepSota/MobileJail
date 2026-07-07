import React, { useState } from 'react';
import { useBilibiliStore } from '../state';
import { useBilibiliGestures } from '../hooks/useBilibiliGestures';
import { IcNavBack, IcImage, IcClose } from '../res/icons';
import * as MediaService from '@/os/MediaService';

export const DynamicPublishPage: React.FC = () => {
  const user = useBilibiliStore(s => s.user);
  const publishDynamic = useBilibiliStore(s => s.publishDynamic);
  const { bindTap, bindBack, back } = useBilibiliGestures();

  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [pickingImage, setPickingImage] = useState(false);

  const handlePickImage = async () => {
    if (pickingImage) return;
    setPickingImage(true);
    try {
      const result = await MediaService.pickMedia({ type: 'image', multiple: true, maxSelect: 9 });
      if (!result.cancelled && result.selected.length > 0) {
        setImages(prev => [...prev, ...result.selected.map(m => m.uri)].slice(0, 9));
      }
    } finally {
      setPickingImage(false);
    }
  };

  const removeImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
  };

  const canPublish = text.trim().length > 0 || images.length > 0;

  const handlePublish = () => {
    if (!canPublish) return;
    publishDynamic(text.trim(), images.length > 0 ? images : undefined);
    setText('');
    setImages([]);
    back();
  };

  return (
    <div className="flex flex-col h-full bg-app-surface">
      <div className="pt-10 px-4 pb-3 flex items-center justify-between border-b border-gray-100">
        <button className="w-8 h-8 flex items-center justify-start" {...bindBack()}>
          <IcNavBack size={24} className="text-app-text" />
        </button>
        <div className="text-[17px] font-medium text-app-text">发布动态</div>
        <button
          className={`text-[15px] font-bold ${canPublish ? 'text-[#00A1D6]' : 'text-gray-300'}`}
          {...bindTap({ kind: 'action', id: 'dynamic.publish.submit' }, { onTrigger: handlePublish })}
        >
          发布
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4" data-scroll-container="main" data-scroll-direction="vertical">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="分享你的动态..."
          className="w-full min-h-[120px] text-[16px] text-app-text placeholder-gray-400 outline-none resize-none"
        />

        {images.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {images.map((img, idx) => (
              <div key={idx} className="relative">
                <img src={img} alt="" className="w-[72px] h-[72px] rounded-lg object-cover bg-gray-100" />
                <button
                  type="button"
                  onClick={() => removeImage(idx)}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-gray-800/70 rounded-full flex items-center justify-center text-white"
                >
                  <IcClose size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 px-4 py-3 flex items-center" data-keep-keyboard="true">
        <button
          type="button"
          {...bindTap({ kind: 'action', id: 'dynamic.image.pick' }, { onTrigger: handlePickImage })}
          className="text-gray-400 active:text-gray-600"
        >
          <IcImage size={24} />
        </button>
      </div>
    </div>
  );
};

export default DynamicPublishPage;