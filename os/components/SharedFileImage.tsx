import type { ImgHTMLAttributes } from 'react';
import type { FileShareInput } from '../types/fileShare';
import { useFileObjectUrl } from './useFileObjectUrl';

export interface SharedFileImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  fileRef: FileShareInput | null | undefined;
  fallbackSrc?: string;
}

/** Image element that can display a FileRefV1/content://simfs attachment. */
export function SharedFileImage({
  fileRef,
  fallbackSrc,
  alt = '',
  ...props
}: SharedFileImageProps) {
  const objectUrl = useFileObjectUrl(fileRef);
  return <img {...props} src={objectUrl ?? fallbackSrc} alt={alt} />;
}

export default SharedFileImage;

