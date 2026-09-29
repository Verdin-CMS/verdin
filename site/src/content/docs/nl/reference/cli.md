---
title: Referentie van de opdrachtregel
description: Elk commando, subcommando en elke vlag van de binary verdin, met wat het leest, schrijft en afdrukt.
sidebar:
  order: 2
  label: Opdrachtregel
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

`verdin` is de enige binary: hij maakt projecten aan, draait de server, past migraties toe,
beheert beheerders en verhuist content naar binnen en naar buiten. Deze pagina somt elk commando
en elke vlag op.

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| Commando | Wat het doet |
| --- | --- |
| [`verdin new`](#verdin-new) | Een projectmap aanmaken. |
| [`verdin dev`](#verdin-dev) | De server in ontwikkelmodus draaien. |
| [`verdin start`](#verdin-start) | De server in productiemodus draaien. |
| [`verdin schema check`](#verdin-schema-check) | De schemabestanden valideren. |
| [`verdin migrate plan`](#verdin-migrate-plan) | De migratiestappen en hun SQL tonen. |
| [`verdin migrate apply`](#verdin-migrate-apply) | De migratiestappen toepassen. |
| [`verdin admin create`](#verdin-admin-create) | Een Super Admin aanmaken. |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | Het wachtwoord van een beheerder instellen. |
| [`verdin types`](#verdin-types) | TypeScript-definities van de content-API genereren. |
| [`verdin import strapi`](#verdin-import-strapi) | Een Strapi-export importeren. |
| [`verdin import verdin`](#verdin-import-verdin) | Een Verdin-export importeren. |
| [`verdin export`](#verdin-export) | Het project naar een `.tar.gz`-archief schrijven. |
| [`verdin healthcheck`](#verdin-healthcheck) | Controleren dat de lokale server antwoordt. |
| [`verdin secrets`](#verdin-secrets) | Nieuwe geheimen afdrukken. |
| [`verdin version`](#verdin-version) | De versie afdrukken. |

## Globale opties

| Optie | Standaard | Beschrijving |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | Het configuratiebestand van het project. Wordt ook gelezen uit `VERDIN_CONFIG`. De projectroot is de map van het bestand: het schema, plugins, uploads en relatieve SQLite-paden worden daartegen opgelost. |
| `-h, --help` | | Help voor het commando afdrukken. |
| `-V, --version` | | De versie afdrukken. |

`verdin help <COMMAND>` drukt dezelfde help af als `--help`.

Elk commando behalve `new`, `secrets` en `version` laadt eerst het project:

1. Het leest het bestand `.env` naast het configuratiebestand, als dat er is. Variabelen die al in
   de omgeving zijn ingesteld, winnen.
2. Het laadt `verdin.toml` (optioneel) en de overschrijvingen `VERDIN_*`. Zie de
   [configuratiereferentie](/nl/reference/configuration/).
3. Het begint te loggen naar standard error, met `[log]` en `RUST_LOG`.

Commando's die de database openen, hebben `VERDIN_DATABASE_URL` of `[database].url` nodig.
Commando's die beheerdersaccounts aanraken of de server draaien, hebben ook
`VERDIN_ADMIN_JWT_SECRET` en `VERDIN_TOKEN_PEPPER` nodig.

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

Maakt een project aan in `DIR`, dat niet mag bestaan of leeg moet zijn:

| Bestand | Inhoud |
| --- | --- |
| `verdin.toml` | `[server]`, `[api]` en `[admin]` met hun standaardwaarden. |
| `.env` | `VERDIN_DATABASE_URL`, en nieuwe `VERDIN_ADMIN_JWT_SECRET` en `VERDIN_TOKEN_PEPPER`. Alleen door jou leesbaar (modus `0600` op Unix). |
| `.gitignore` | `.env`, `data/`, SQLite-bestanden en `.cache/`. |
| `schema/content-types/`, `schema/components/` | Lege schemamappen. |
| `data/` | Voor de SQLite-database (alleen SQLite). |

| Argument of optie | Standaard | Beschrijving |
| --- | --- | --- |
| `<DIR>` | | Aan te maken map. |
| `--database <DATABASE>` | `sqlite` | Database waarnaar de `.env` wijst: `sqlite`, `postgres`, `mysql` of `mariadb`. |

Met `sqlite` is de URL `sqlite://data/verdin.db`. Met de andere is het de URL van een lokale server
met de gebruiker `verdin`, het wachtwoord `change-me` en een database die naar de map is genoemd
(kleine letters, cijfers en `_`): pas hem aan voordat je start.

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

Draait de server in ontwikkelmodus. Vergeleken met `verdin start`:

- Openstaande migraties met het risiconiveau `safe` worden bij het opstarten toegepast.
  Riskantere stappen stoppen de server; bekijk ze met [`verdin migrate plan`](#verdin-migrate-plan).
- De **Contenttype-bouwer** van het beheerpaneel bewerkt de schemabestanden en de server herlaadt
  het schema.
- De refresh-cookie wordt niet als `Secure` gemarkeerd (tenzij `[admin].secure_cookies` dat zegt),
  zodat je via gewoon HTTP kunt inloggen.
- Webhooks en deploydoelen mogen loopback- en privéadressen aanroepen (tenzij
  `[webhooks].allow_private_networks` iets anders zegt).

Hij stopt bij Ctrl+C of `SIGTERM`.

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

Draait de server in productiemodus. Hij weigert te starten als de database achterloopt op het
schema, zodat een deploy nooit tabellen wijzigt die je niet hebt bekeken.

| Optie | Beschrijving |
| --- | --- |
| `--migrate` | Openstaande `safe` migratiestappen toepassen vóór het starten. Riskante en destructieve stappen vereisen nog steeds `verdin migrate apply`. |

Voordat hij luistert, controleert hij de configuratie (`[api].prefix` en `[admin].path` zien eruit
als `/api`, paginagroottes zijn consistent, `[server].trusted_proxies` en `[api].cors_origins`
kunnen worden geparsed) en maakt hij de ingebouwde rollen aan. Hij logt een waarschuwing als
`[admin].secure_cookies` `false` is of `[email].provider` `log` is. Als er nog geen beheerder is,
logt hij het adres van het beheerpaneel, waar de eerste bezoeker de eerste Super Admin registreert.

Hij stopt bij Ctrl+C of `SIGTERM`.

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

Valideert de schemabestanden (`[schema].path`) zonder de database aan te raken. Hij drukt een
samenvatting af, of faalt met de fouten, elk met zijn bestand en attribuutpad:

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

Gebruik hem in CI vóór een deploy. Zie [Attribuuttypes](/nl/reference/attribute-types/) voor wat
elk attribuut accepteert.

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Vergelijkt de database met het schema en drukt af wat `verdin migrate apply` zou doen, zonder iets
te wijzigen: genummerde stappen, elk met zijn risiconiveau en zijn SQL. Hij drukt
`database is up to date` af als er niets te doen is.

| Optie | Beschrijving |
| --- | --- |
| `--rename-table <OLD=NEW>` | De tabel `OLD` behandelen als hernoemd naar `NEW` (behoudt zijn rijen) in plaats van de ene te verwijderen en de andere aan te maken. Herhaalbaar. |
| `--rename-column <TABLE.OLD=NEW>` | De kolom `OLD` van `TABLE` behandelen als hernoemd naar `NEW` (behoudt zijn waarden). `TABLE` is de nieuwe naam van de tabel. Herhaalbaar. |

Risiconiveaus:

| Niveau | Betekenis |
| --- | --- |
| `safe` | Kan geen gegevens verliezen of falen op bestaande rijen: nieuwe tabellen, nieuwe kolommen die nullable zijn of een standaardwaarde hebben, hernoemingen, indexen die niet uniek zijn. |
| `risky` | Kan falen op bestaande rijen of waarden omzetten: wijzigingen van kolomtypes, nieuwe kolommen die niet nullable zijn en geen standaardwaarde hebben, unieke indexen op bestaande tabellen. |
| `destructive` | Verwijdert kolommen of tabellen. |

Als een stap boven `safe` ligt, eindigt het plan met de vlag die ervoor nodig is
(`requires: verdin migrate apply --allow risky`). Als een verwijderde kolom of tabel eruitziet als
een hernoemde, somt hij de hernoemingsvlaggen op om mee te geven. Als een vorige migratie is
onderbroken, toont hij hoeveel stappen zijn toegepast en de laatste fout.

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

Zie [Schemamigraties](/nl/concepts/schema-migrations/).

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Past het plan toe. Hij neemt dezelfde hernoemingsopties als `verdin migrate plan`; geef dezelfde
mee die je hebt bekeken.

| Optie | Standaard | Beschrijving |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | Hoogste risiconiveau om toe te passen: `safe`, `risky` of `destructive`. Een plan met een stap daarboven wordt geweigerd voordat er iets draait. |
| `--rename-table <OLD=NEW>` | | Zoals bij `verdin migrate plan`. |
| `--rename-column <TABLE.OLD=NEW>` | | Zoals bij `verdin migrate plan`. |

Hij drukt `applied N steps` af, of `database is up to date`. Herstel na een onderbreking (een
verbroken verbinding, een mislukte stap) de oorzaak en draai hem opnieuw: hij gaat verder bij de
stap die niet is voltooid.

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

Maakt een Super Admin aan. Het wachtwoord wordt gelezen uit `VERDIN_ADMIN_PASSWORD`, of van
standard input als die niet is ingesteld. De database moet up-to-date zijn met het schema.

| Optie | Beschrijving |
| --- | --- |
| `--email <EMAIL>` | Het e-mailadres van de nieuwe beheerder. |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

Gebruik hem om de eerste beheerder aan te maken van een server die nog niet in een browser
bereikbaar is; anders registreert de eerste bezoeker van het beheerpaneel hem.

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

Stelt het wachtwoord van een beheerder in, ontgrendelt het account na mislukte logins en beëindigt
al zijn sessies. Het wachtwoord wordt gelezen zoals bij `verdin admin create`.

| Optie | Beschrijving |
| --- | --- |
| `--email <EMAIL>` | Het e-mailadres van de beheerder. |

Hij verwijdert geen tweede factoren; een beheerder met **Gebruikers beheren** kan die resetten in
**Instellingen → Gebruikers**.

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

Genereert TypeScript-definities van de content-API (één interface per contenttype en component)
uit het schema, en drukt ze af naar standard output. Hij heeft de database niet nodig.

| Optie | Beschrijving |
| --- | --- |
| `-o, --out <OUT>` | In plaats daarvan naar dit bestand schrijven. |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

Zie [Getypeerde client](/nl/guides/frontend/typed-client/).

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

Importeert een Strapi v4- of v5-project uit een export die is gemaakt met
`strapi export --no-encrypt`: een `.tar.gz`, een `.tar` of een uitgepakte map. Hij schrijft de
contenttypes en componenten als schemabestanden, en importeert daarna items, locales, media,
relaties en mappen.

| Argument of optie | Beschrijving |
| --- | --- |
| `<PATH>` | Het exportbestand of de exportmap. |
| `--schema-only` | Alleen de schemabestanden schrijven. |
| `--force` | Bestaande schemabestanden overschrijven, en importeren in contenttypes die al items hebben. |

Hij drukt af wat hij heeft geschreven en geïmporteerd, met waarschuwingen voor wat hij niet kon
meenemen, en schrijft `strapi-id-map.json` in de projectroot: de Strapi-id's en hun nieuwe
`documentId`s en bestands-id's in Verdin, om links in je frontend te corrigeren.

Zie [Migreren vanaf Strapi](/nl/migrate/from-strapi/).

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

Importeert een archief dat door `verdin export` is geschreven: schemabestanden, locales, media en
items.

| Argument of optie | Beschrijving |
| --- | --- |
| `<PATH>` | Het `.tar.gz`-bestand. |
| `--force` | Schemabestanden die afwijken overschrijven, en importeren in contenttypes die al items hebben. |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

Schrijft het schema, de content en de media van het project naar een `.tar.gz`-archief: een
back-up, of een manier om een project met `verdin import verdin` naar een andere instantie te
verhuizen. Het archief bevat elke versie van elk item (concepten, gepubliceerde versies, locales)
met zijn relaties. Beheerdersaccounts, API-tokens en instellingen zitten er niet in.

| Argument of optie | Beschrijving |
| --- | --- |
| `<OUTPUT>` | Het te schrijven archief. |
| `--no-media` | De mediabibliotheek weglaten: bestanden, mappen en de koppelingen van items ernaartoe. |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

Zie [Back-ups](/nl/deploy/backups/).

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

Vraagt `GET /_health` op bij de server op deze machine (`127.0.0.1`, de `[server].port` uit de
configuratie) en sluit af met status 0 als die `200` antwoordt, anders met 1, met de reden erbij.
Hij heeft geen shell, `curl` of HTTP-client nodig, dus het Docker-image gebruikt hem als
`HEALTHCHECK`; gebruik hem op dezelfde manier in Compose of elke supervisor die een commando
draait.

| Optie | Beschrijving |
| --- | --- |
| `--port <PORT>` | Deze poort controleren in plaats van `[server].port`. |

```text title="Terminal"
$ verdin healthcheck
ok
```

Zie [Monitoring](/nl/deploy/monitoring/).

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

Drukt een nieuwe `VERDIN_ADMIN_JWT_SECRET` en `VERDIN_TOKEN_PEPPER` af, klaar voor een `.env`-bestand
of de secret store van je platform. Hij leest geen project.

`VERDIN_ADMIN_JWT_SECRET` wijzigen maakt de kortlevende access tokens van beheerders en
eindgebruikers ongeldig, net als open voorbeeldlinks en OAuth-logins die nog bezig zijn; het
beheerpaneel en clients die refresh tokens gebruiken, krijgen zelf nieuwe. `VERDIN_TOKEN_PEPPER`
wijzigen maakt opgeslagen tokens ongeldig (API-tokens inbegrepen), dus houd hem vast zodra hij in
gebruik is.

## `verdin version`

```text title="Terminal"
verdin version
```

Drukt `verdin` en de versie af, zoals `verdin --version`.
