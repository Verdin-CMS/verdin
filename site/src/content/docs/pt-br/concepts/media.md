---
title: "Mídia"
description: "A biblioteca de mídia, os campos de mídia, os formatos de imagem, os provedores de armazenamento (local ou S3) e as pastas, e como os arquivos são vinculados ao conteúdo."
sidebar:
  order: 8
---

A biblioteca de mídia guarda as imagens, os vídeos, os áudios e os outros arquivos que o seu
conteúdo usa. Esta página explica como os arquivos são armazenados, descritos e vinculados aos
documentos. Para servir imagens redimensionadas no seu site, veja
[Imagens](/pt-br/guides/frontend/images/).

## Arquivos

Cada upload é um registro de arquivo no formato do Strapi, então os frontends escritos para o
Strapi o leem sem mudanças (`formats` abreviado):

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

- `size` está em kilobytes, como no Strapi.
- O tipo MIME vem dos bytes do arquivo, nunca do que o cliente declara.
- `focalPoint` marca a parte de uma imagem que deve continuar visível quando ela é cortada.

Os arquivos não têm rascunho: um upload fica disponível assim que é armazenado.

## A biblioteca de mídia

No painel de administração, a **Biblioteca de mídia** lista os arquivos com busca, filtros por
tipo e pastas. Os administradores enviam arquivos, os importam de uma URL, editam o nome, o
texto alternativo, a legenda e o ponto focal, substituem o conteúdo de um arquivo mantendo o
seu id e veem **onde ele é usado**: campos de mídia, mídia dentro de componentes, blocos de rich
text e Markdown que contém a sua URL.

As **Pastas** organizam a biblioteca para os editores. Os objetos de arquivo nas respostas da
API não as mostram, mas um upload pela API de conteúdo pode indicar o id de uma pasta no seu
`fileInfo`. Excluir uma pasta exclui os arquivos dentro dela.

O acesso administrativo é controlado pelas permissões `media.read`, `media.create`,
`media.update` e `media.delete`. A função Author integrada só pode editar e excluir os arquivos
que ela mesma enviou. Veja [Permissões](/pt-br/concepts/permissions/).

## Campos de mídia

Um tipo de conteúdo vincula arquivos por meio de um atributo `media`:

```json
"cover": { "type": "media", "allowedTypes": ["images"] },
"gallery": { "type": "media", "multiple": true, "allowedTypes": ["images", "videos"] }
```

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `multiple` | `false` | Guarda uma lista de arquivos em vez de um. |
| `allowedTypes` | qualquer arquivo | Qualquer um de `images`, `videos`, `audios` e `files` (qualquer outro), verificado em toda escrita contra o tipo MIME armazenado. |

Os campos de mídia se comportam como relações: cada versão de um documento tem os seus próprios
vínculos, a publicação os copia e o `required` é verificado ao publicar. Eles são armazenados em
uma tabela de vínculos por campo. Dentro de [componentes](/pt-br/concepts/components-and-dynamic-zones/),
o JSON do componente guarda os ids dos arquivos.

Nas escritas, envie ids de arquivo: `5`, `{ "id": 5 }`, `[5, 6]` ou `null` para limpar o
campo. Nas leituras, os campos de mídia só são retornados quando populados (`populate=cover`),
como objetos de arquivo. Excluir um arquivo o remove de todos os documentos que o usavam.

## Formatos de imagem

Quando uma imagem raster é enviada, o Verdin gera os formatos do Strapi no próprio formato da
imagem, respeitando a sua orientação EXIF:

| Formato | Tamanho |
| --- | --- |
| `thumbnail` | Cabe em 245 × 156 |
| `large` | 1000 px de largura |
| `medium` | 750 px de largura |
| `small` | 500 px de largura |

Um formato é pulado quando o original não é maior do que ele. `[upload].breakpoints` altera as
larguras e os nomes, e `responsive_formats = false` os desativa. `max_original_size` reduz os
originais grandes no upload, o que também remove os seus metadados (EXIF, GPS).
`max_image_megapixels` (100 por padrão) recusa imagens que ocupariam memória demais para
decodificar. Com o provedor local, `/uploads` também pode redimensionar e converter imagens sob
demanda; veja [Imagens](/pt-br/guides/frontend/images/).

## Provedores de armazenamento

Os arquivos são armazenados por um provedor, definido em `[upload].provider`:

| Provedor | Armazena os arquivos | Serve os arquivos |
| --- | --- | --- |
| `local` (padrão) | Em `public/uploads` (a opção `dir`), relativo ao projeto | Em `/uploads` no servidor Verdin |
| `s3` | Em qualquer bucket compatível com S3: AWS S3, Cloudflare R2, Backblaze B2, MinIO, RustFS… | A partir do `public_url` do bucket ou da CDN |

```toml title="verdin.toml"
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

As credenciais do S3 vêm das variáveis de ambiente padrão `AWS_*`, nunca do `verdin.toml`.
Todas as opções estão na [referência de configuração](/pt-br/reference/configuration/).

Os nomes armazenados são `{slug}_{random}{ext}` e nunca mudam, então as URLs podem ficar em
cache para sempre. Com várias instâncias do Verdin, use S3: os arquivos locais só existem na
instância que os recebeu.

## Segurança

- Os uploads são transmitidos para arquivos temporários, nunca mantidos em memória, e limitados
  por `[upload].max_file_size` (200 MB por padrão), com no máximo 20 arquivos por requisição.
- Os arquivos servidos de `/uploads` levam `Content-Security-Policy: sandbox` e
  `X-Content-Type-Options: nosniff`. Tudo o que não é imagem, vídeo, áudio, PDF ou texto simples
  é enviado como download, então um arquivo HTML ou SVG enviado não consegue rodar scripts no
  seu domínio. Os objetos desses tipos também são armazenados como downloads no S3.

## Mídia pela API de conteúdo

A API de conteúdo tem as rotas de upload do Strapi, verificadas contra as permissões da
**Biblioteca de mídia** (`plugin::upload`):

| Rota | Permissão |
| --- | --- |
| `POST /api/upload` (multipart `files`, `fileInfo` opcional) | `create` |
| `POST /api/upload?id={id}` (novo `fileInfo`, opcionalmente um novo arquivo) | `update` |
| `GET /api/upload/files` | `find` |
| `GET /api/upload/files/{id}` | `findOne` |
| `DELETE /api/upload/files/{id}` | `delete` |

Como no Strapi, elas respondem objetos de arquivo e arrays simples, sem o envelope `data`. Veja
[API REST](/pt-br/api/rest/#biblioteca-de-mídia). As alterações enviam os eventos de
[webhook](/pt-br/api/webhooks/) e de [tempo real](/pt-br/api/realtime/) `media.create`,
`media.update` e `media.delete`.
