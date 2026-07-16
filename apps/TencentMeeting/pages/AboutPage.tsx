import React from 'react';
import { IcNavBack, IcLauncher } from '../res/icons';
import { useMeetingGestures } from '../hooks/useMeetingGestures';
import { useTencentMeetingStrings } from '../hooks/useTencentMeetingStrings';

export const AboutPage: React.FC = () => {
  const s = useTencentMeetingStrings();
  const { bindBack } = useMeetingGestures();

  return (
    <div className="h-full bg-[#f5f6f7] flex flex-col" data-status-bar-foreground="dark">
      <div className="h-10 shrink-0" />
      <div className="h-12 px-3 flex items-center bg-white border-b border-gray-100 shrink-0">
        <button type="button" className="w-10 h-10 flex items-center justify-center" {...bindBack()}>
          <IcNavBack size={24} className="text-gray-900" />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-medium text-gray-900">{s.menu_about}</h1>
        <div className="w-10" />
      </div>
      <div className="flex-1 overflow-y-auto" data-scroll-container="main" data-scroll-direction="vertical">
        <div className="flex flex-col items-center pt-12 pb-8">
          <div className="w-20 h-20 rounded-2xl bg-white shadow-sm flex items-center justify-center">
            <IcLauncher size={58} />
          </div>
          <div className="mt-4 text-[19px] font-semibold text-gray-900">{s.app_name}</div>
          <div className="mt-1 text-[13px] text-gray-400">{s.settings_about_version}</div>
        </div>
        <div className="mx-4 bg-white rounded-2xl overflow-hidden">
          {[s.about_check_update, s.about_terms, s.about_privacy].map((label, index) => (
            <div key={label} className={`h-13 px-4 flex items-center ${index ? 'border-t border-gray-100' : ''}`}>
              <span className="flex-1 text-[15px] text-gray-900">{label}</span>
              <span className="text-gray-300">›</span>
            </div>
          ))}
        </div>
        <div className="px-8 pt-10 text-center text-[12px] leading-5 text-gray-400">
          {s.about_copyright}
        </div>
      </div>
    </div>
  );
};

export default AboutPage;
