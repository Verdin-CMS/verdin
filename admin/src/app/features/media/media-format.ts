/** Small helpers shared by the media library, its picker and the media field control. */

import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/messages/en';
import { mediaKind } from '../../core/media';
import { MediaFile, MediaFolder, MediaKind } from '../../core/types';

export const MEDIA_KINDS: MediaKind[] = ['images', 'videos', 'audios', 'files'];

export const KIND_LABELS: Record<MediaKind, MessageKey> = {
  images: 'media.kind.images',
  videos: 'media.kind.videos',
  audios: 'media.kind.audios',
  files: 'media.kind.files',
};

export const KIND_ICONS: Record<MediaKind, string> = {
  images: 'lucideImage',
  videos: 'lucideVideo',
  audios: 'lucideMusic',
  files: 'lucideFile',
};

export function fileKind(file: Pick<MediaFile, 'mime'>): MediaKind {
  return mediaKind(file.mime ?? '');
}

/** `.png` → `PNG`. */
export function extension(file: Pick<MediaFile, 'ext' | 'name'>): string {
  const ext = file.ext || (file.name.includes('.') ? file.name.split('.').pop() : '') || '';
  return ext.replace(/^\./, '').toUpperCase();
}

/** A size in kilobytes (as the API reports it), as "12.3 KB" or "4.5 MB". */
export function formatSize(i18n: I18n, kilobytes: number): string {
  const round = (value: number) => Math.round(value * 10) / 10;
  return kilobytes >= 1024
    ? i18n.t('media.size.mb', { size: i18n.formatNumber(round(kilobytes / 1024)) })
    : i18n.t('media.size.kb', { size: i18n.formatNumber(round(kilobytes)) });
}

/** `1920 × 1080`, or `null` when the file has no dimensions. */
export function dimensions(file: Pick<MediaFile, 'width' | 'height'>): string | null {
  return file.width && file.height ? `${file.width} × ${file.height}` : null;
}

export function altText(file: Pick<MediaFile, 'alternativeText' | 'name'>): string {
  return file.alternativeText || file.name;
}

/** Whether the admin may run a media action on a file (`own` grants cover their uploads). */
export function canTouch(auth: Auth, action: string, file: MediaFile): boolean {
  const grant = auth.mediaGrant(action);
  return grant === 'all' || (grant === 'own' && file.createdBy === auth.user()?.id);
}

export interface FolderOption {
  id: number;
  label: string;
  path: string;
}

/** Every folder labelled by its full name ("Photos / 2026"), sorted by that label. */
export function folderOptions(folders: MediaFolder[]): FolderOption[] {
  return folders
    .map((folder) => ({
      id: folder.id,
      path: folder.path,
      label: folderChain(folder, folders)
        .map((item) => item.name)
        .join(' / '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The folders from the root down to `folder` (its `path` is a chain of `pathId`s). */
export function folderChain(folder: MediaFolder, folders: MediaFolder[]): MediaFolder[] {
  const byPathId = new Map(folders.map((item) => [item.pathId, item]));
  return folder.path
    .split('/')
    .filter(Boolean)
    .map((segment) => byPathId.get(Number(segment)))
    .filter((item): item is MediaFolder => !!item);
}

/** Whether `folder` is `ancestor` or lies below it. */
export function isWithin(folder: MediaFolder, ancestor: MediaFolder): boolean {
  return folder.path === ancestor.path || folder.path.startsWith(`${ancestor.path}/`);
}
