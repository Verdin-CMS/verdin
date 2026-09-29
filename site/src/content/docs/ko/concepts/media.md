---
title: "미디어"
description: "미디어 라이브러리, 미디어 필드, 이미지 포맷, 스토리지 프로바이더(로컬 또는 S3)와 폴더, 파일이 콘텐츠에 연결되는 방식."
sidebar:
  order: 8
---

미디어 라이브러리는 콘텐츠가 쓰는 이미지, 동영상, 오디오 등의 파일을 담습니다. 이 페이지에서는 파일을
저장하고, 기술하고, 문서에 연결하는 방식을 설명합니다. 사이트에서 크기를 조정한 이미지를 제공하는 방법은
[이미지](/ko/guides/frontend/images/)를 참고하세요.

## 파일

업로드마다 Strapi 형식의 파일 레코드가 만들어지므로 Strapi용 프런트엔드가 그대로 읽을 수 있습니다
(`formats`는 줄임).

```json
{
  "id": 5,
  "documentId": "v3k…",
  "name": "harbour.jpg",
  "alternativeText": "Boats in the harbour at dawn",
  "caption": null,
  "width": 2400,
  "height": 1600,
  "focalPoint": { "x": 0.4, "y": 0.6 },
  "formats": {
    "thumbnail": { "url": "/uploads/harbour_thumbnail_4f1c.jpg", "width": 234, "height": 156 },
    "large": { "url": "/uploads/harbour_large_4f1c.jpg", "width": 1000, "height": 667 }
  },
  "hash": "harbour_4f1c",
  "ext": ".jpg",
  "mime": "image/jpeg",
  "size": 812.4,
  "url": "/uploads/harbour_4f1c.jpg",
  "previewUrl": null,
  "provider": "local",
  "provider_metadata": null,
  "createdAt": "2026-09-25T09:00:00.000Z",
  "updatedAt": "2026-09-25T09:00:00.000Z",
  "publishedAt": "2026-09-25T09:00:00.000Z"
}
```

- `size`는 Strapi처럼 킬로바이트 단위입니다.
- MIME 타입은 클라이언트가 주장하는 값이 아니라 파일의 바이트에서 판단합니다.
- `focalPoint`는 이미지를 자를 때 화면에 남길 부분을 표시합니다.

파일에는 초안이 없습니다. 업로드는 저장되는 즉시 사용할 수 있습니다.

## 미디어 라이브러리

관리자 패널의 **미디어 라이브러리**는 검색, 타입별 필터, 폴더와 함께 파일을 나열합니다. 관리자는 파일을
업로드하고, URL에서 가져오고, 이름, 대체 텍스트, 캡션, 초점을 편집하고, id를 유지한 채 파일 내용을 교체하고,
**어디에 쓰이는지** 볼 수 있습니다. 미디어 필드, 컴포넌트 안의 미디어, 리치 텍스트 블록, 파일 URL이 들어간
Markdown입니다.

**폴더**는 편집자를 위해 라이브러리를 정리합니다. API 응답의 파일 객체에는 폴더가 나오지 않지만, 콘텐츠
API로 업로드할 때 `fileInfo`에 폴더 id를 지정할 수 있습니다. 폴더를 삭제하면 그 안의 파일도 삭제됩니다.

관리자의 접근은 `media.read`, `media.create`, `media.update`, `media.delete` 권한으로 제어합니다.
기본 제공되는 Author 역할은 자신이 업로드한 파일만 편집하고 삭제할 수 있습니다.
[권한](/ko/concepts/permissions/)을 참고하세요.

## 미디어 필드

콘텐츠 타입은 `media` 속성으로 파일을 연결합니다.

```json
"cover": { "type": "media", "allowedTypes": ["images"] },
"gallery": { "type": "media", "multiple": true, "allowedTypes": ["images", "videos"] }
```

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `multiple` | `false` | 파일 하나 대신 파일 리스트를 담습니다. |
| `allowedTypes` | 모든 파일 | `images`, `videos`, `audios`, `files`(그 밖의 모든 것) 중 아무것이나. 쓸 때마다 저장된 MIME 타입으로 검사합니다. |

미디어 필드는 관계처럼 동작합니다. 문서의 버전마다 자체 링크가 있고, 게시하면 링크가 복사되며,
`required`는 게시할 때 검사합니다. 필드마다 링크 테이블에 저장됩니다.
[컴포넌트](/ko/concepts/components-and-dynamic-zones/) 안에서는 컴포넌트의 JSON이 대신 파일 id를 저장합니다.

쓸 때는 파일 id를 보냅니다: `5`, `{ "id": 5 }`, `[5, 6]`, 필드를 비우려면 `null`. 읽을 때 미디어 필드는
populate했을 때만(`populate=cover`) 파일 객체로 반환됩니다. 파일을 삭제하면 그 파일을 쓰던 모든 문서에서
제거됩니다.

## 이미지 포맷

래스터 이미지가 업로드되면 Verdin은 EXIF 방향을 반영해 이미지 자체의 포맷으로 Strapi의 포맷을
생성합니다.

| 포맷 | 크기 |
| --- | --- |
| `thumbnail` | 245 × 156 안에 맞춤 |
| `large` | 너비 1000 px |
| `medium` | 너비 750 px |
| `small` | 너비 500 px |

원본이 해당 포맷보다 크지 않으면 그 포맷은 건너뜁니다. `[upload].breakpoints`로 너비와 이름을 바꾸고,
`responsive_formats = false`로 끕니다. `max_original_size`는 업로드 시 큰 원본을 축소하며, 이때
메타데이터(EXIF, GPS)도 제거됩니다. `max_image_megapixels`(기본 100)는 디코딩에 메모리가 너무 많이 드는
이미지를 거부합니다. 로컬 프로바이더에서는 `/uploads`가 요청에 따라 이미지 크기를 조정하고 변환할 수도
있습니다. [이미지](/ko/guides/frontend/images/)를 참고하세요.

## 스토리지 프로바이더

파일은 `[upload].provider`에 설정한 프로바이더가 저장합니다.

| 프로바이더 | 파일 저장 위치 | 제공 위치 |
| --- | --- | --- |
| `local` (기본값) | 프로젝트 기준 `public/uploads`(`dir` 옵션) | Verdin 서버의 `/uploads` |
| `s3` | S3 호환 버킷 어디든: AWS S3, Cloudflare R2, Backblaze B2, MinIO, RustFS… | 버킷이나 CDN의 `public_url` |

```toml title="verdin.toml"
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

S3 자격 증명은 `verdin.toml`이 아니라 표준 `AWS_*` 환경 변수에서 가져옵니다. 모든 옵션은
[설정 레퍼런스](/ko/reference/configuration/)에 있습니다.

저장되는 이름은 `{slug}_{random}{ext}`이며 절대 바뀌지 않으므로 URL을 영구히 캐시할 수 있습니다. Verdin
인스턴스가 여러 개면 S3를 쓰세요. 로컬 파일은 그 파일을 받은 인스턴스에만 존재합니다.

## 안전

- 업로드는 메모리에 담지 않고 임시 파일로 스트리밍하며, `[upload].max_file_size`(기본 200 MB)로 제한하고
  요청당 파일은 최대 20개입니다.
- `/uploads`에서 제공하는 파일에는 `Content-Security-Policy: sandbox`와
  `X-Content-Type-Options: nosniff`가 붙습니다. 이미지, 동영상, 오디오, PDF, 일반 텍스트가 아닌 것은
  다운로드로 보내므로, 업로드한 HTML이나 SVG 파일이 도메인에서 스크립트를 실행할 수 없습니다. S3에서도
  이런 타입의 객체는 다운로드로 저장됩니다.

## 콘텐츠 API로 미디어 다루기

콘텐츠 API에는 **미디어 라이브러리**(`plugin::upload`)에 대한 권한으로 확인하는 Strapi의 업로드 라우트가
있습니다.

| 라우트 | 권한 |
| --- | --- |
| `POST /api/upload` (multipart `files`, 선택 사항인 `fileInfo`) | `create` |
| `POST /api/upload?id={id}` (새 `fileInfo`, 선택적으로 새 파일) | `update` |
| `GET /api/upload/files` | `find` |
| `GET /api/upload/files/{id}` | `findOne` |
| `DELETE /api/upload/files/{id}` | `delete` |

Strapi처럼 이 라우트는 `data` 봉투 없이 일반 파일 객체와 배열로 응답합니다.
[REST API](/ko/api/rest/#미디어-라이브러리)를 참고하세요. 변경 사항은 `media.create`, `media.update`,
`media.delete` [웹훅](/ko/api/webhooks/)과 [실시간](/ko/api/realtime/) 이벤트를 보냅니다.
