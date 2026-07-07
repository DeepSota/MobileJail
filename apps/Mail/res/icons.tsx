import {
  Mail,
  MailOpen,
  Inbox,
  Send,
  Edit3,
  Trash2,
  Star,
  Paperclip,
  Image as ImageIcon,
  FileText,
  Film,
  Music,
  Camera,
  File as FileIcon,
  ArrowLeft,
  Plus,
  Search,
  ChevronRight,
  ChevronDown,
  X,
  Reply,
  Forward,
  User,
  AtSign,
  Check,
  Menu,
} from 'lucide-react';

// --- Re-export aliases (Ic* prefix per platform icon convention) ---

export const IcLauncher = Mail;
export const IcMail = Mail;
export const IcMailOpen = MailOpen;
export const IcInbox = Inbox;
export const IcSend = Send;
export const IcEdit = Edit3;
export const IcTrash = Trash2;
export const IcStar = Star;
export const IcPaperclip = Paperclip;
export const IcImage = ImageIcon;
export const IcDocument = FileText;
export const IcVideo = Film;
export const IcAudio = Music;
export const IcCamera = Camera;
export const IcFile = FileIcon;
export const IcNavBack = ArrowLeft;
export const IcAdd = Plus;
export const IcSearch = Search;
export const IcNavForward = ChevronRight;
export const IcExpand = ChevronDown;
export const IcClose = X;
export const IcReply = Reply;
export const IcForward = Forward;
export const IcUser = User;
export const IcAt = AtSign;
export const IcCheck = Check;
export const IcMenu = Menu;

/** ICON_REGISTRY — dynamic name → component lookup, used by AttachmentChip / MailItem to render
 *  type-driven icons from string ids (catalog in constants.ts uses Ic* alias strings). */
export const ICON_REGISTRY: Record<string, React.FC<{ size?: number; className?: string }>> = {
  IcMail,
  IcMailOpen,
  IcInbox,
  IcSend,
  IcEdit,
  IcTrash,
  IcStar,
  IcPaperclip,
  IcImage,
  IcDocument,
  IcVideo,
  IcAudio,
  IcCamera,
  IcFile,
  IcNavBack,
  IcAdd,
  IcSearch,
  IcNavForward,
  IcExpand,
  IcClose,
  IcReply,
  IcForward,
  IcUser,
  IcAt,
  IcCheck,
  IcMenu,
};
