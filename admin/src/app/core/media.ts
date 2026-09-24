import { HttpClient, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { Api, ApiFailure, RUNTIME_CONFIG, toQuery } from './api';
import { MediaFile, MediaFolder, MediaKind, PageMeta } from './types';

export type MediaSort =
  'createdAtDesc' | 'createdAtAsc' | 'nameAsc' | 'nameDesc' | 'updatedAtDesc' | 'sizeDesc';

export interface MediaQuery {
  /** `root` (default), a folder id, or `all`. */
  folder?: number | 'root' | 'all';
  search?: string;
  types?: MediaKind[];
  sort?: MediaSort;
  page?: number;
  pageSize?: number;
}

/** Editable metadata; `null` clears. */
export interface MediaInfo {
  name?: string;
  alternativeText?: string | null;
  caption?: string | null;
  folder?: number | null;
  focalPoint?: { x: number; y: number } | null;
}

/** Progress of one upload: `progress` 0–1, then `file` once stored. */
export type UploadEvent = { progress: number; file?: undefined } | { progress: 1; file: MediaFile };

/** Kinds of files, by MIME type (as the server classifies them). */
export function mediaKind(mime: string): MediaKind {
  if (mime.startsWith('image/')) return 'images';
  if (mime.startsWith('video/')) return 'videos';
  if (mime.startsWith('audio/')) return 'audios';
  return 'files';
}

/** Admin media library API. */
@Injectable({ providedIn: 'root' })
export class Media {
  private readonly api = inject(Api);
  private readonly http = inject(HttpClient);
  private readonly config = inject(RUNTIME_CONFIG);

  list(query: MediaQuery = {}): Promise<{ data: MediaFile[]; meta: { pagination?: PageMeta } }> {
    const folder = query.folder ?? 'root';
    return this.api.list<MediaFile>(
      '/upload/files',
      toQuery({
        folder: String(folder),
        search: query.search,
        types: query.types?.length ? query.types.join(',') : undefined,
        sort: query.sort,
        page: query.page,
        pageSize: query.pageSize,
      }),
    );
  }

  get(id: number): Promise<MediaFile> {
    return this.api.get(`/upload/files/${id}`);
  }

  /** Uploads one file, reporting progress. */
  upload(file: File, info: MediaInfo = {}): Observable<UploadEvent> {
    const form = new FormData();
    form.append('files', file, file.name);
    form.append('fileInfo', JSON.stringify(info));
    return this.http
      .post<{ data: MediaFile[] }>(`${this.config.apiBase}/upload`, form, {
        reportProgress: true,
        observe: 'events',
        withCredentials: true,
      })
      .pipe(
        map((event): UploadEvent => {
          if (event.type === HttpEventType.UploadProgress) {
            return { progress: event.total ? Math.min(event.loaded / event.total, 0.99) : 0 };
          }
          if (event.type === HttpEventType.Response) {
            const stored = event.body?.data[0];
            if (!stored) throw new ApiFailure(500, 'Error', 'The server returned no file');
            return { progress: 1, file: stored };
          }
          return { progress: 0 };
        }),
      );
  }

  update(id: number, info: MediaInfo): Promise<MediaFile> {
    return this.api.put(`/upload/files/${id}`, info);
  }

  delete(id: number): Promise<void> {
    return this.api.delete(`/upload/files/${id}`);
  }

  folders(parent: number | 'root' = 'root'): Promise<MediaFolder[]> {
    return this.api.get('/upload/folders', `parent=${parent}`);
  }

  allFolders(): Promise<MediaFolder[]> {
    return this.api.get('/upload/folders/all');
  }

  folder(id: number): Promise<MediaFolder> {
    return this.api.get(`/upload/folders/${id}`);
  }

  createFolder(name: string, parent: number | null): Promise<MediaFolder> {
    return this.api.post('/upload/folders', { name, parent });
  }

  updateFolder(
    id: number,
    changes: { name?: string; parent?: number | null },
  ): Promise<MediaFolder> {
    return this.api.put(`/upload/folders/${id}`, changes);
  }

  deleteFolder(id: number): Promise<void> {
    return this.api.delete(`/upload/folders/${id}`);
  }

  /** Absolute URL of a file or format (local files are served at `/uploads` on this origin). */
  url(url: string): string {
    return url;
  }

  /** The smallest format at least `width` wide, else the original. */
  preview(file: MediaFile, width = 245): string {
    const formats = Object.values(file.formats ?? {}).sort((a, b) => a.width - b.width);
    return formats.find((format) => format.width >= width)?.url ?? file.url;
  }
}
