---
title: "Médias"
description: "La médiathèque, les champs de média, les formats d’image, les fournisseurs de stockage (local ou S3) et les dossiers, et comment les fichiers sont liés au contenu."
sidebar:
  order: 8
---

La médiathèque contient les images, vidéos, fichiers audio et autres fichiers qu’utilise votre
contenu. Cette page explique comment les fichiers sont stockés, décrits et liés aux documents.
Pour servir des images redimensionnées sur votre site, voir [Images](/fr/guides/frontend/images/).

## Fichiers

Chaque téléversement est un enregistrement de fichier au format de Strapi, si bien que les
frontends écrits pour Strapi le lisent sans modification (`formats` abrégé) :

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

- `size` est exprimé en kilo-octets, comme dans Strapi.
- Le type MIME est déterminé à partir des octets du fichier, jamais de ce qu’affirme le client.
- `focalPoint` marque la partie d’une image à garder visible quand elle est recadrée.

Les fichiers n’ont pas de brouillon : un fichier téléversé est disponible dès qu’il est stocké.

## La médiathèque

Dans le panneau d’administration, la **Médiathèque** liste les fichiers avec une recherche, des
filtres par type et des dossiers. Les administrateurs téléversent des fichiers, les importent
depuis une URL, modifient leur nom, leur texte alternatif, leur légende et leur point focal,
remplacent le contenu d’un fichier en conservant son identifiant, et voient **où il est
utilisé** : champs de média, médias dans les composants, blocs de texte enrichi et Markdown
contenant son URL.

Les **Dossiers** organisent la médiathèque pour les rédacteurs. Les objets fichier des
réponses de l’API ne les montrent pas, mais un téléversement via l’API de contenu peut indiquer
un identifiant de dossier dans son `fileInfo`. Supprimer un dossier supprime les fichiers qu’il
contient.

L’accès en administration est contrôlé par les autorisations `media.read`, `media.create`,
`media.update` et `media.delete`. Le rôle intégré Author ne peut modifier et supprimer que les
fichiers qu’il a téléversés. Voir [Autorisations](/fr/concepts/permissions/).

## Champs de média

Un type de contenu lie des fichiers via un attribut `media` :

```json
"cover": { "type": "media", "allowedTypes": ["images"] },
"gallery": { "type": "media", "multiple": true, "allowedTypes": ["images", "videos"] }
```

| Option | Valeur par défaut | Description |
| --- | --- | --- |
| `multiple` | `false` | Contient une liste de fichiers au lieu d’un seul. |
| `allowedTypes` | tout fichier | N’importe lesquels de `images`, `videos`, `audios` et `files` (tout le reste), vérifiés à chaque écriture par rapport au type MIME stocké. |

Les champs de média se comportent comme des relations : chaque version d’un document a ses
propres liens, la publication les copie, et `required` est vérifié à la publication. Ils sont
stockés dans une table de liaison par champ. Dans les
[composants](/fr/concepts/components-and-dynamic-zones/), c’est le JSON du composant qui stocke
les identifiants de fichiers.

À l’écriture, envoyez des identifiants de fichiers : `5`, `{ "id": 5 }`, `[5, 6]`, ou `null`
pour vider le champ. À la lecture, les champs de média ne sont renvoyés que s’ils sont peuplés
(`populate=cover`), sous forme d’objets fichier. Supprimer un fichier le retire de tous les
documents qui l’utilisaient.

## Formats d’image

Quand une image matricielle est téléversée, Verdin génère les formats de Strapi dans le format
propre de l’image, en respectant son orientation EXIF :

| Format | Taille |
| --- | --- |
| `thumbnail` | Tient dans 245 × 156 |
| `large` | 1000 px de large |
| `medium` | 750 px de large |
| `small` | 500 px de large |

Un format est omis quand l’original n’est pas plus grand que lui. `[upload].breakpoints` modifie
les largeurs et les noms, et `responsive_formats = false` les désactive. `max_original_size`
réduit les grands originaux au téléversement, ce qui supprime aussi leurs métadonnées (EXIF,
GPS). `max_image_megapixels` (100 par défaut) refuse les images dont le décodage prendrait trop
de mémoire. Avec le fournisseur local, `/uploads` peut aussi redimensionner et convertir les
images à la demande ; voir [Images](/fr/guides/frontend/images/).

## Fournisseurs de stockage

Les fichiers sont stockés par un fournisseur, défini dans `[upload].provider` :

| Fournisseur | Stocke les fichiers | Les sert |
| --- | --- | --- |
| `local` (par défaut) | Dans `public/uploads` (l’option `dir`), relatif au projet | Sur `/uploads` du serveur Verdin |
| `s3` | Dans n’importe quel bucket compatible S3 : AWS S3, Cloudflare R2, Backblaze B2, MinIO, RustFS… | Depuis le `public_url` du bucket ou du CDN |

```toml title="verdin.toml"
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

Les identifiants S3 proviennent des variables d’environnement standard `AWS_*`, jamais de
`verdin.toml`. Toutes les options figurent dans la
[référence de configuration](/fr/reference/configuration/).

Les noms stockés sont de la forme `{slug}_{random}{ext}` et ne changent jamais : les URL
peuvent donc être mises en cache indéfiniment. Avec plusieurs instances de Verdin, utilisez S3 :
les fichiers locaux n’existent que sur l’instance qui les a reçus.

## Sécurité

- Les téléversements sont écrits en streaming dans des fichiers temporaires, jamais gardés en
  mémoire, et limités par `[upload].max_file_size` (200 Mo par défaut), avec au plus 20 fichiers
  par requête.
- Les fichiers servis depuis `/uploads` portent `Content-Security-Policy: sandbox` et
  `X-Content-Type-Options: nosniff`. Tout ce qui n’est pas une image, une vidéo, un fichier
  audio, un PDF ou du texte brut est envoyé en téléchargement, si bien qu’un fichier HTML ou
  SVG téléversé ne peut pas exécuter de scripts sur votre domaine. Les objets de ces types sont
  aussi stockés en téléchargement sur S3.

## Les médias via l’API de contenu

L’API de contenu propose les routes de téléversement de Strapi, contrôlées par les accès sur la
**Médiathèque** (`plugin::upload`) :

| Route | Accès |
| --- | --- |
| `POST /api/upload` (`files` en multipart, `fileInfo` facultatif) | `create` |
| `POST /api/upload?id={id}` (nouveau `fileInfo`, éventuellement un nouveau fichier) | `update` |
| `GET /api/upload/files` | `find` |
| `GET /api/upload/files/{id}` | `findOne` |
| `DELETE /api/upload/files/{id}` | `delete` |

Comme dans Strapi, ces routes renvoient de simples objets fichier et tableaux, sans l’enveloppe
`data`. Voir [API REST](/fr/api/rest/#médiathèque). Les modifications envoient les événements
[webhook](/fr/api/webhooks/) et [temps réel](/fr/api/realtime/) `media.create`,
`media.update` et `media.delete`.
