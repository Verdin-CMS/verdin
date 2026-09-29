---
title: "媒体"
description: "媒体库、媒体字段、图片格式、存储提供方（本地或 S3）和文件夹，以及文件如何与内容关联。"
sidebar:
  order: 8
---

媒体库存放内容所用的图片、视频、音频和其他文件。本页说明文件如何存储、描述以及与文档关联。如何在网站上提供缩放后的图片，请参见[图片](/zh-cn/guides/frontend/images/)。

## 文件

每次上传都会生成一条 Strapi 格式的文件记录，因此为 Strapi 编写的前端无需修改即可读取（`formats` 已省略部分内容）：

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

- 与 Strapi 一样，`size` 的单位是千字节。
- MIME 类型根据文件的字节内容判断，从不采信客户端的声明。
- `focalPoint` 标记图片被裁剪时需要保留在视野中的部分。

文件没有草稿：上传内容一经存储即可使用。

## 媒体库

在管理后台中，**媒体库** 列出所有文件，支持搜索、按类型筛选和文件夹。管理员可以上传文件、从 URL 导入文件、编辑文件名、替代文本、说明文字和焦点，在保留 id 的同时替换文件内容，还可以查看**文件的使用位置**：媒体字段、组件内的媒体、富文本区块以及包含其 URL 的 Markdown。

**文件夹** 用于为编辑整理媒体库。API 响应中的文件对象不会显示文件夹，但通过内容 API 上传时，可以在 `fileInfo` 中指定文件夹 id。删除文件夹会删除其中的文件。

管理后台的访问由 `media.read`、`media.create`、`media.update` 和 `media.delete` 权限控制。内置的 Author 角色只能编辑和删除自己上传的文件。参见[权限](/zh-cn/concepts/permissions/)。

## 媒体字段

内容类型通过 `media` 属性关联文件：

```json
"cover": { "type": "media", "allowedTypes": ["images"] },
"gallery": { "type": "media", "multiple": true, "allowedTypes": ["images", "videos"] }
```

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `multiple` | `false` | 存放文件列表，而不是单个文件。 |
| `allowedTypes` | 任意文件 | `images`、`videos`、`audios` 和 `files`（其他任何文件）中的任意几种，每次写入时对照已存储的 MIME 类型进行检查。 |

媒体字段的行为与关联相同：文档的每个版本都有自己的链接，发布时会复制这些链接，`required` 在发布时检查。它们存储在每个字段各自的链接表中。在[组件](/zh-cn/concepts/components-and-dynamic-zones/)内部，则由组件的 JSON 存放文件 id。

写入时发送文件 id：`5`、`{ "id": 5 }`、`[5, 6]`，或者用 `null` 清空该字段。读取时，媒体字段只有在 populate 时（`populate=cover`）才会以文件对象的形式返回。删除文件会将其从所有使用它的文档中移除。

## 图片格式

上传光栅图片时，Verdin 会以图片自身的格式生成 Strapi 的各个格式，并遵循其 EXIF 方向信息：

| 格式 | 尺寸 |
| --- | --- |
| `thumbnail` | 适配 245 × 156 以内 |
| `large` | 宽 1000 px |
| `medium` | 宽 750 px |
| `small` | 宽 500 px |

如果原图不大于某个格式，就会跳过该格式。`[upload].breakpoints` 可以修改宽度和名称，`responsive_formats = false` 会关闭这些格式。`max_original_size` 会在上传时缩小过大的原图，同时丢弃其元数据（EXIF、GPS）。`max_image_megapixels`（默认 100）会拒绝解码时需要占用过多内存的图片。使用本地提供方时，`/uploads` 还可以按请求缩放和转换图片；参见[图片](/zh-cn/guides/frontend/images/)。

## 存储提供方

文件由提供方存储，在 `[upload].provider` 中设置：

| 提供方 | 存储位置 | 提供方式 |
| --- | --- | --- |
| `local`（默认） | 相对于项目的 `public/uploads`（`dir` 选项） | 由 Verdin 服务器在 `/uploads` 提供 |
| `s3` | 任何兼容 S3 的存储桶：AWS S3、Cloudflare R2、Backblaze B2、MinIO、RustFS…… | 从存储桶或 CDN 的 `public_url` 提供 |

```toml title="verdin.toml"
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

S3 凭据来自标准的 `AWS_*` 环境变量，从不来自 `verdin.toml`。所有选项请参见[配置参考](/zh-cn/reference/configuration/)。

存储的文件名为 `{slug}_{random}{ext}`，并且永远不会改变，因此 URL 可以被永久缓存。运行多个 Verdin 实例时请使用 S3：本地文件只存在于接收它们的那个实例上。

## 安全

- 上传内容以流的方式写入临时文件，从不整体保存在内存中，大小受 `[upload].max_file_size`（默认 200 MB）限制，每个请求最多 20 个文件。
- 从 `/uploads` 提供的文件带有 `Content-Security-Policy: sandbox` 和 `X-Content-Type-Options: nosniff`。任何不是图片、视频、音频、PDF 或纯文本的文件都会以下载形式发送，因此上传的 HTML 或 SVG 文件无法在你的域名上运行脚本。在 S3 上，这类对象同样以下载形式存储。

## 通过内容 API 使用媒体

内容 API 提供 Strapi 的上传路由，按 **媒体库**（`plugin::upload`）上的授权进行检查：

| 路由 | 授权 |
| --- | --- |
| `POST /api/upload`（multipart `files`，可选的 `fileInfo`） | `create` |
| `POST /api/upload?id={id}`（新的 `fileInfo`，可选的新文件） | `update` |
| `GET /api/upload/files` | `find` |
| `GET /api/upload/files/{id}` | `findOne` |
| `DELETE /api/upload/files/{id}` | `delete` |

与 Strapi 一样，它们返回普通的文件对象和数组，不带 `data` 包裹层。参见 [REST API](/zh-cn/api/rest/#媒体库)。变更会发送 `media.create`、`media.update` 和 `media.delete` [webhook](/zh-cn/api/webhooks/) 事件和[实时](/zh-cn/api/realtime/)事件。
