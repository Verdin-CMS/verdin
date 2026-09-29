---
title: Còpies de seguretat
description: Fes còpies de seguretat d'un projecte Verdin amb bolcats de la base de dades i còpies de l'emmagatzematge de multimèdia, o trasllada'l amb verdin export i verdin import verdin.
sidebar:
  order: 9
---

Les dades d'un projecte Verdin són en dos llocs: la **base de dades** (contingut,
administradors, rols, tokens, configuració, historial, registres d'auditoria) i
l'**emmagatzematge de multimèdia** (els fitxers de la mediateca, al disc o en un bucket). Els
fitxers d'esquema són al teu repositori. Fes còpia de seguretat de tots dos magatzems;
`verdin export` hi afegeix un arxiu portable del contingut.

| Mètode | Conté | Fes-lo servir per a |
| --- | --- | --- |
| Bolcat de la base de dades + còpia de multimèdia | Tot | Recuperació davant desastres del mateix projecte |
| `verdin export` | Esquema, idiomes, multimèdia, totes les versions de totes les entrades | Traslladar contingut a una altra instància o motor de base de dades; una còpia addicional i portable |

## Bolcats de la base de dades

Fes servir les eines de la teva base de dades, o les còpies automàtiques del teu proveïdor:

```sh frame="terminal"
# PostgreSQL
pg_dump --format=custom --file=verdin-$(date +%F).dump "$VERDIN_DATABASE_URL"

# MySQL / MariaDB
mysqldump --single-transaction --routines -h <host> -u <user> -p <database> > verdin-$(date +%F).sql

# SQLite: una còpia coherent mentre el servidor s'executa
sqlite3 /data/verdin.db ".backup '/backups/verdin-$(date +%F).db'"
```

No copiïs un fitxer SQLite en ús amb `cp`: fes servir `.backup` (o atura primer el servidor).

Un bolcat conté hashes de contrasenyes, hashes de tokens d'API i camps privats. Xifra'l i
guarda'l lluny dels servidors que protegeix. Per restaurar-ne un, també necessites els mateixos
`VERDIN_TOKEN_PEPPER` i `VERDIN_ADMIN_JWT_SECRET`: sense el pepper, els tokens d'API i els codis
de l'app d'autenticació dels administradors deixen de funcionar.

## Emmagatzematge de multimèdia

- **Proveïdor local**: copia el directori de pujades (`[upload].provider.dir`, `/data/uploads`
  a la imatge Docker) amb la teva còpia de seguretat de fitxers habitual, després del bolcat de
  la base de dades perquè no falti cap fitxer referenciat pel bolcat.
- **Proveïdor S3**: activa el versionat o la replicació al bucket, o copia'l amb les eines del
  teu proveïdor.

La memòria cau de transformació d'imatges i l'índex de cerca es poden reconstruir i no necessiten
còpia de seguretat.

## `verdin export`

`verdin export` escriu l'esquema, el contingut i la multimèdia d'un projecte en un sol
`.tar.gz`, i `verdin import verdin` el restaura al mateix projecte o a una altra instància, amb
qualsevol motor de base de dades.

```sh frame="terminal"
verdin export backup-2026-09-28.tar.gz            # esquema, idiomes, multimèdia i entrades
verdin export content-only.tar.gz --no-media      # sense fitxers multimèdia
verdin import verdin backup-2026-09-28.tar.gz     # en aquest projecte
```

Executa'ls amb la configuració del projecte (el mateix `verdin.toml` i entorn que el servidor).
En un contenidor: `docker compose exec verdin verdin export /data/backup.tar.gz`.

### Què s'inclou

- **Fitxers d'esquema**, tal com són.
- **Idiomes.** Un projecte buit els agafa tots, inclòs el per defecte. Un projecte que ja té
  idiomes només rep els que falten.
- **Carpetes i fitxers de multimèdia**, amb els seus formats responsius. Els fitxers conserven
  el seu `documentId`; els seus ids numèrics canvien.
- **Totes les versions de totes les entrades**: esborranys, versions publicades i tots els
  idiomes, amb les seves dates, relacions (per `documentId`) i multimèdia, incloses les
  relacions i la multimèdia dins de components i zones dinàmiques. S'hi inclouen els camps
  privats i els hashes de contrasenyes.

**No s'inclou**: usuaris administradors, rols, tokens d'API, webhooks, configuració de
funcionalitats, fluxos de revisió i llançaments. Torna'ls a crear a la destinació, o restaura un
bolcat de la base de dades.

:::caution
Una exportació conté camps privats i hashes de contrasenyes. Guarda-la com un bolcat de la base
de dades.
:::

### Importació

1. La importació escriu els fitxers d'esquema i migra la base de dades només amb passos segurs.
2. Si ja existeixen fitxers d'esquema diferents, s'atura, tret que passis `--force`.
3. Si hi ha tipus de contingut que ja tenen entrades, també s'atura, tret que passis `--force`;
   aleshores les entrades s'afegeixen al costat de les existents.
4. Els documents importats conserven el seu `documentId`, de manera que importar en un projecte
   que ja té els mateixos documents falla.

La importació no dispara webhooks ni hooks de connectors, i no escriu historial.

### Format de l'arxiu

Un arxiu tar comprimit amb gzip:

| Camí | Contingut |
| --- | --- |
| `manifest.json` | `format: "verdin-export"`, versió del format, versió de Verdin, versions per tipus de contingut |
| `schema/…` | Els fitxers d'esquema |
| `locales.json` | `{ default, locales: [{ code, name }] }` |
| `folders.json`, `files.jsonl` | Carpetes i fitxers de multimèdia, un objecte JSON per línia |
| `assets/{hash}{ext}` | Els objectes desats dels fitxers i els seus formats |
| `entries/{uid}.jsonl` | Una versió per línia: `documentId`, `locale`, `published`, dates, `data`, `relations`, `media` |

Per portar-hi un projecte de Strapi, consulta [Migrar des de Strapi](/ca/migrate/from-strapi/).

## Prova les restauracions

De tant en tant, restaura en una base de dades de prova, inicia-hi Verdin amb `verdin start` i
comprova que pots iniciar la sessió i llegir entrades i multimèdia.
