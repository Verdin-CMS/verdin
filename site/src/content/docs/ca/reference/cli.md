---
title: Referència de la línia d'ordres
description: Totes les ordres, subordres i indicadors del binari verdin, amb el que llegeixen, escriuen i imprimeixen.
sidebar:
  order: 2
  label: Línia d'ordres
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

`verdin` és l'únic binari: crea projectes, executa el servidor, aplica migracions, gestiona els
usuaris administradors i fa entrar i sortir contingut. Aquesta pàgina llista totes les ordres i
tots els indicadors.

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| Ordre | Què fa |
| --- | --- |
| [`verdin new`](#verdin-new) | Crea un directori de projecte. |
| [`verdin dev`](#verdin-dev) | Executa el servidor en mode de desenvolupament. |
| [`verdin start`](#verdin-start) | Executa el servidor en mode de producció. |
| [`verdin schema check`](#verdin-schema-check) | Valida els fitxers d'esquema. |
| [`verdin migrate plan`](#verdin-migrate-plan) | Mostra els passos de migració i el seu SQL. |
| [`verdin migrate apply`](#verdin-migrate-apply) | Aplica els passos de migració. |
| [`verdin admin create`](#verdin-admin-create) | Crea un Super Admin. |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | Defineix la contrasenya d'un administrador. |
| [`verdin types`](#verdin-types) | Genera definicions TypeScript de l'API de contingut. |
| [`verdin import strapi`](#verdin-import-strapi) | Importa una exportació de Strapi. |
| [`verdin import verdin`](#verdin-import-verdin) | Importa una exportació de Verdin. |
| [`verdin export`](#verdin-export) | Escriu el projecte en un arxiu `.tar.gz`. |
| [`verdin healthcheck`](#verdin-healthcheck) | Comprova que el servidor local respon. |
| [`verdin secrets`](#verdin-secrets) | Imprimeix secrets nous. |
| [`verdin version`](#verdin-version) | Imprimeix la versió. |

## Opcions globals

| Opció | Per defecte | Descripció |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | El fitxer de configuració del projecte. També es llegeix de `VERDIN_CONFIG`. L'arrel del projecte és el directori del fitxer: l'esquema, els connectors, les pujades i els camins relatius de SQLite es resolen a partir d'aquí. |
| `-h, --help` | | Imprimeix l'ajuda de l'ordre. |
| `-V, --version` | | Imprimeix la versió. |

`verdin help <COMMAND>` imprimeix la mateixa ajuda que `--help`.

Totes les ordres excepte `new`, `secrets` i `version` carreguen primer el projecte:

1. Llegeix el fitxer `.env` que hi ha al costat del fitxer de configuració, si n'hi ha. Les
   variables ja definides a l'entorn tenen prioritat.
2. Carrega `verdin.toml` (opcional) i els valors `VERDIN_*` que el sobreescriuen. Consulta la
   [referència de configuració](/ca/reference/configuration/).
3. Comença a registrar a la sortida d'error estàndard, amb `[log]` i `RUST_LOG`.

Les ordres que obren la base de dades necessiten `VERDIN_DATABASE_URL` o `[database].url`. Les
ordres que toquen comptes d'administració o executen el servidor també necessiten
`VERDIN_ADMIN_JWT_SECRET` i `VERDIN_TOKEN_PEPPER`.

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

Crea un projecte a `DIR`, que no ha d'existir o ha d'estar buit:

| Fitxer | Contingut |
| --- | --- |
| `verdin.toml` | `[server]`, `[api]` i `[admin]` amb els seus valors per defecte. |
| `.env` | `VERDIN_DATABASE_URL`, i uns `VERDIN_ADMIN_JWT_SECRET` i `VERDIN_TOKEN_PEPPER` nous. Només el pots llegir tu (mode `0600` a Unix). |
| `.gitignore` | `.env`, `data/`, fitxers SQLite i `.cache/`. |
| `schema/content-types/`, `schema/components/` | Directoris d'esquema buits. |
| `data/` | Per a la base de dades SQLite (només SQLite). |

| Argument o opció | Per defecte | Descripció |
| --- | --- | --- |
| `<DIR>` | | Directori que cal crear. |
| `--database <DATABASE>` | `sqlite` | Base de dades a la qual apunta el `.env`: `sqlite`, `postgres`, `mysql` o `mariadb`. |

Amb `sqlite`, l'URL és `sqlite://data/verdin.db`. Amb els altres és l'URL d'un servidor local amb
l'usuari `verdin`, la contrasenya `change-me` i una base de dades amb el nom del directori (lletres
minúscules, dígits i `_`): edita'l abans d'iniciar.

```text title="Terminal"
$ verdin new blog --database postgres
created blog

  cd blog
  verdin dev

then open http://localhost:1337/admin/ to register the first admin
```

## `verdin dev`

```text title="Terminal"
verdin dev
```

Executa el servidor en mode de desenvolupament. En comparació amb `verdin start`:

- Les migracions pendents amb el nivell de risc `safe` s'apliquen en iniciar. Els passos més
  arriscats aturen el servidor; revisa'ls amb [`verdin migrate plan`](#verdin-migrate-plan).
- El **Constructor de tipus de contingut** del tauler d'administració edita els fitxers d'esquema i
  el servidor torna a carregar l'esquema.
- La galeta de refresc no es marca com a `Secure` (tret que ho digui `[admin].secure_cookies`), de
  manera que pots iniciar la sessió per HTTP pla.
- Els webhooks i els destins de desplegament poden cridar adreces de loopback i privades (tret que
  `[webhooks].allow_private_networks` digui el contrari).

S'atura amb Ctrl+C o `SIGTERM`.

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

Executa el servidor en mode de producció. Es nega a iniciar-se quan la base de dades va per darrere
de l'esquema, de manera que un desplegament mai no canvia taules que no has revisat.

| Opció | Descripció |
| --- | --- |
| `--migrate` | Aplica els passos de migració `safe` pendents abans d'iniciar. Els passos arriscats i destructius continuen necessitant `verdin migrate apply`. |

Abans d'escoltar, comprova la configuració (`[api].prefix` i `[admin].path` tenen la forma de
`/api`, les mides de pàgina són coherents, `[server].trusted_proxies` i `[api].cors_origins`
s'analitzen correctament) i crea els rols integrats. Registra un avís quan `[admin].secure_cookies`
és `false` o `[email].provider` és `log`. Quan encara no hi ha cap administrador, registra l'adreça
del tauler d'administració, on el primer visitant registra el primer Super Admin.

S'atura amb Ctrl+C o `SIGTERM`.

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

Valida els fitxers d'esquema (`[schema].path`) sense tocar la base de dades. Imprimeix un resum, o
falla amb els errors, cadascun amb el seu fitxer i el camí de l'atribut:

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

Fes-lo servir a la CI abans d'un desplegament. Consulta [Tipus d'atribut](/ca/reference/attribute-types/)
per saber què accepta cada atribut.

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Compara la base de dades amb l'esquema i imprimeix què faria `verdin migrate apply`, sense canviar
res: passos numerats, cadascun amb el seu nivell de risc i el seu SQL. Imprimeix
`database is up to date` quan no hi ha res a fer.

| Opció | Descripció |
| --- | --- |
| `--rename-table <OLD=NEW>` | Tracta la taula `OLD` com a reanomenada a `NEW` (en conserva les files) en lloc d'eliminar-ne una i crear l'altra. Repetible. |
| `--rename-column <TABLE.OLD=NEW>` | Tracta la columna `OLD` de `TABLE` com a reanomenada a `NEW` (en conserva els valors). `TABLE` és el nom nou de la taula. Repetible. |

Nivells de risc:

| Nivell | Significat |
| --- | --- |
| `safe` | No pot perdre dades ni fallar amb les files existents: taules noves, columnes noves que admeten nuls o tenen valor per defecte, canvis de nom, índexs no únics. |
| `risky` | Pot fallar amb les files existents o convertir valors: canvis de tipus de columna, columnes noves que no admeten nuls i no tenen valor per defecte, índexs únics en taules existents. |
| `destructive` | Elimina columnes o taules. |

Quan un pas supera `safe`, el pla acaba amb l'indicador que necessita
(`requires: verdin migrate apply --allow risky`). Quan una columna o taula eliminada sembla una de
reanomenada, llista els indicadors de canvi de nom que cal passar. Quan una migració anterior es va
interrompre, mostra quants passos s'han aplicat i l'últim error.

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

Consulta [Migracions d'esquema](/ca/concepts/schema-migrations/).

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Aplica el pla. Accepta les mateixes opcions de canvi de nom que `verdin migrate plan`; passa les
mateixes que has revisat.

| Opció | Per defecte | Descripció |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | El nivell de risc més alt que cal aplicar: `safe`, `risky` o `destructive`. Un pla amb un pas que el supera es rebutja abans d'executar res. |
| `--rename-table <OLD=NEW>` | | Com a `verdin migrate plan`. |
| `--rename-column <TABLE.OLD=NEW>` | | Com a `verdin migrate plan`. |

Imprimeix `applied N steps`, o `database is up to date`. Després d'una interrupció (una connexió
perduda, un pas que ha fallat), corregeix-ne la causa i torna-la a executar: continua al pas que no
s'ha completat.

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

Crea un Super Admin. La contrasenya es llegeix de `VERDIN_ADMIN_PASSWORD`, o de l'entrada estàndard
quan aquesta variable no està definida. La base de dades ha d'estar al dia amb l'esquema.

| Opció | Descripció |
| --- | --- |
| `--email <EMAIL>` | L'adreça de correu electrònic del nou administrador. |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

Fes-la servir per crear el primer administrador d'un servidor que encara no és accessible des d'un
navegador; si no, el registra el primer visitant del tauler d'administració.

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

Defineix la contrasenya d'un administrador, desbloqueja el compte després d'inicis de sessió
fallits i en tanca totes les sessions. La contrasenya es llegeix com a `verdin admin create`.

| Opció | Descripció |
| --- | --- |
| `--email <EMAIL>` | L'adreça de correu electrònic de l'administrador. |

No elimina els segons factors; un administrador amb **Gestiona els usuaris** els pot restablir a
**Configuració → Usuaris**.

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

Genera definicions TypeScript de l'API de contingut (una interfície per tipus de contingut i
component) a partir de l'esquema, i les imprimeix a la sortida estàndard. No necessita la base de
dades.

| Opció | Descripció |
| --- | --- |
| `-o, --out <OUT>` | Escriu en aquest fitxer. |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

Consulta [Client tipat](/ca/guides/frontend/typed-client/).

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

Importa un projecte de Strapi v4 o v5 a partir d'una exportació feta amb
`strapi export --no-encrypt`: un `.tar.gz`, un `.tar` o un directori desempaquetat. Escriu els
tipus de contingut i els components com a fitxers d'esquema, i després importa les entrades, els
idiomes, la multimèdia, les relacions i les carpetes.

| Argument o opció | Descripció |
| --- | --- |
| `<PATH>` | El fitxer o directori d'exportació. |
| `--schema-only` | Només escriu els fitxers d'esquema. |
| `--force` | Sobreescriu els fitxers d'esquema existents, i importa en tipus de contingut que ja tenen entrades. |

Imprimeix què ha escrit i importat, amb avisos per al que no ha pogut traslladar, i escriu
`strapi-id-map.json` a l'arrel del projecte: els ids de Strapi i els seus nous `documentId` i ids de
fitxer de Verdin, per corregir els enllaços del teu frontend.

Consulta [Migrar des de Strapi](/ca/migrate/from-strapi/).

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

Importa un arxiu escrit per `verdin export`: fitxers d'esquema, idiomes, multimèdia i entrades.

| Argument o opció | Descripció |
| --- | --- |
| `<PATH>` | El fitxer `.tar.gz`. |
| `--force` | Sobreescriu els fitxers d'esquema diferents, i importa en tipus de contingut que ja tenen entrades. |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

Escriu l'esquema, el contingut i la multimèdia del projecte en un arxiu `.tar.gz`: una còpia de
seguretat, o una manera de traslladar un projecte a una altra instància amb `verdin import verdin`.
L'arxiu conté totes les versions de totes les entrades (esborranys, versions publicades, idiomes)
amb les seves relacions. Els comptes d'administració, els tokens d'API i la configuració no
s'inclouen.

| Argument o opció | Descripció |
| --- | --- |
| `<OUTPUT>` | L'arxiu que cal escriure. |
| `--no-media` | Deixa fora la mediateca: fitxers, carpetes i els enllaços de les entrades cap a ells. |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

Consulta [Còpies de seguretat](/ca/deploy/backups/).

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

Demana `GET /_health` al servidor d'aquesta màquina (`127.0.0.1`, el `[server].port` de la
configuració) i surt amb l'estat 0 quan respon `200`, i 1 si no, imprimint-ne el motiu. No necessita
shell, `curl` ni client HTTP, així que la imatge Docker la fa servir com a `HEALTHCHECK`; fes-la
servir de la mateixa manera a Compose o a qualsevol supervisor que executi una ordre.

| Opció | Descripció |
| --- | --- |
| `--port <PORT>` | Comprova aquest port en lloc de `[server].port`. |

```text title="Terminal"
$ verdin healthcheck
ok
```

Consulta [Monitoratge](/ca/deploy/monitoring/).

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

Imprimeix uns `VERDIN_ADMIN_JWT_SECRET` i `VERDIN_TOKEN_PEPPER` nous, a punt per a un fitxer `.env`
o per al magatzem de secrets de la teva plataforma. No llegeix cap projecte.

Canviar `VERDIN_ADMIN_JWT_SECRET` anul·la els tokens d'accés de curta durada dels administradors i
dels usuaris finals, els enllaços de previsualització oberts i els inicis de sessió OAuth en curs;
el tauler d'administració i els clients que fan servir tokens de renovació n'obtenen de nous sols.
Canviar `VERDIN_TOKEN_PEPPER` invalida els tokens desats (entre ells els tokens d'API), així que
conserva'l un cop en ús.

## `verdin version`

```text title="Terminal"
verdin version
```

Imprimeix `verdin` i la versió, com `verdin --version`.
