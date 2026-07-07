import React from 'react';
import { useXStore, selectUser } from '../state';
import { useXGestures } from '../hooks/useXGestures';
import { useXStrings } from '../hooks/useXStrings';
import { XImage } from '../components/XMedia';
import { IcCamera } from '../res/icons';
import * as MediaService from '../../../os/MediaService';

export const EditProfilePage: React.FC = () => {
  const user = useXStore(selectUser);
  const updateUser = useXStore(s => s.updateUser);
  const { bindBack, bindTap, back } = useXGestures();
  const s = useXStrings();

  const [name, setName] = React.useState(user.name);
  const [bio, setBio] = React.useState(user.bio ?? '');
  const [location, setLocation] = React.useState(user.location ?? '');
  const [website, setWebsite] = React.useState(user.website ?? '');
  const [birthDate, setBirthDate] = React.useState(user.birthDate ?? '');
  const [avatar, setAvatar] = React.useState(user.avatar);
  const [banner, setBanner] = React.useState(user.banner ?? '');
  const [pickingImage, setPickingImage] = React.useState(false);

  const handlePickAvatar = async () => {
    if (pickingImage) return;
    setPickingImage(true);
    try {
      const result = await MediaService.pickMedia({ type: 'image', multiple: false, maxSelect: 1 });
      if (!result.cancelled && result.selected.length > 0) {
        const uri = result.selected[0].uri;
        if (uri) setAvatar(uri);
      }
    } finally {
      setPickingImage(false);
    }
  };

  const handlePickBanner = async () => {
    if (pickingImage) return;
    setPickingImage(true);
    try {
      const result = await MediaService.pickMedia({ type: 'image', multiple: false, maxSelect: 1 });
      if (!result.cancelled && result.selected.length > 0) {
        const uri = result.selected[0].uri;
        if (uri) setBanner(uri);
      }
    } finally {
      setPickingImage(false);
    }
  };

  const handleSave = () => {
    updateUser({
      name: name.trim() || user.name,
      bio: bio.trim() || undefined,
      location: location.trim() || undefined,
      website: website.trim() || undefined,
      birthDate: birthDate.trim() || undefined,
      avatar,
      banner: banner || undefined,
    });
    back();
  };

  const hasChanges =
    name.trim() !== user.name ||
    (bio.trim() || undefined) !== (user.bio ?? undefined) ||
    (location.trim() || undefined) !== (user.location ?? undefined) ||
    (website.trim() || undefined) !== (user.website ?? undefined) ||
    (birthDate.trim() || undefined) !== (user.birthDate ?? undefined) ||
    avatar !== user.avatar ||
    banner !== (user.banner ?? '');

  return (
    <div className="flex flex-col bg-app-bg min-h-full text-app-text pt-10">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-app-border sticky top-0 bg-app-bg z-50">
        <button className="text-app-text mr-4" {...bindBack()}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="w-5 h-5 fill-current">
            <g><path d="M7.414 13l5.043 5.04-1.414 1.42L3.586 12l7.457-7.46 1.414 1.42L7.414 11H21v2H7.414z" /></g>
          </svg>
        </button>
        <div className="font-bold text-lg">{s.profile_edit_title}</div>
        <button
          className={`font-bold text-sm px-3 py-1 rounded-full ${hasChanges ? 'bg-app-text text-app-bg' : 'bg-gray-200 text-gray-400'}`}
          disabled={!hasChanges}
          {...(hasChanges ? bindTap('profile.edit.save') : {})}
          onClick={hasChanges ? handleSave : undefined}
        >
          {s.profile_edit_save}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar" data-scroll-container="main" data-scroll-direction="vertical">
        {/* Banner */}
        <div
          className="h-32 bg-gray-200 relative cursor-pointer active:opacity-80"
          {...bindTap('profile.edit.banner.pick')}
          onClick={handlePickBanner}
        >
          {banner ? <XImage src={banner} alt="Banner" className="w-full h-full object-cover" /> : null}
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <IcCamera className="text-white w-8 h-8" />
          </div>
        </div>

        {/* Avatar */}
        <div className="px-4 relative -mt-8 mb-4">
          <div
            className="w-16 h-16 rounded-full bg-app-bg border-4 border-app-bg overflow-hidden relative cursor-pointer active:opacity-80"
            {...bindTap('profile.edit.avatar.pick')}
            onClick={handlePickAvatar}
          >
            {avatar ? (
              <XImage src={avatar} alt={name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-pink-600 flex items-center justify-center text-white font-bold text-xl">
                {name[0]}
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <IcCamera className="text-white w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Form Fields */}
        <div className="px-4 pb-8 space-y-4">
          <EditField label={s.profile_edit_name_label} value={name} onChange={setName} maxLength={50} />
          <EditField label={s.profile_edit_bio_label} value={bio} onChange={setBio} multiline maxLength={160} />
          <EditField label={s.profile_edit_location_label} value={location} onChange={setLocation} maxLength={30} />
          <EditField label={s.profile_edit_website_label} value={website} onChange={setWebsite} maxLength={100} />
          <EditField label={s.profile_edit_birthdate_label} value={birthDate} onChange={setBirthDate} maxLength={30} />
        </div>
      </div>
    </div>
  );
};

interface EditFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  maxLength?: number;
}

const EditField: React.FC<EditFieldProps> = ({ label, value, onChange, multiline, maxLength }) => {
  const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  return (
    <div
      className="border border-app-border rounded-lg px-3 pt-2 pb-1 focus-within:border-blue-500"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      {multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          className="w-full border-none bg-transparent text-app-text outline-none resize-none text-sm leading-normal"
          value={value}
          onChange={e => onChange(e.target.value)}
          maxLength={maxLength}
          rows={3}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
          className="w-full border-none bg-transparent text-app-text outline-none text-sm"
          value={value}
          onChange={e => onChange(e.target.value)}
          maxLength={maxLength}
        />
      )}
    </div>
  );
};