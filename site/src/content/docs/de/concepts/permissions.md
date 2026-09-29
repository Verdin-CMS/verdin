---
title: "Berechtigungen"
description: "Das Gesamtbild der Zugriffskontrolle in Verdin: Admin-Rollen und RBAC mit Feld- und Sprachberechtigungen, die öffentliche Rolle, API-Tokens und Endnutzer-Rollen."
sidebar:
  order: 6
---

Verdin steuert zwei Zielgruppen getrennt: **Admins**, die sich im Admin-Panel anmelden, und
**Aufrufer der Content-API**, die Inhalte aus deinen Websites und Apps lesen und schreiben.
Diese Seite erklärt, wie beide autorisiert werden und wie die Teile zusammenspielen. Die
vollständige Liste der Aktionen steht in der
[Referenz der Berechtigungen](/de/reference/permissions/).

| Wer | Authentifiziert sich mit | Berechtigungen kommen von | Gilt für |
| --- | --- | --- | --- |
| Admin | E-Mail und Passwort (plus zweiter Faktor oder SSO) | Seinen [Rollen](#admin-rollen) | Admin-Panel und [Admin-API](/de/api/admin/) |
| Anonymer Aufrufer | Kein `Authorization`-Header | [Öffentlicher Zugriff](#öffentlicher-zugriff) | REST, GraphQL, Echtzeit |
| Server oder Build | `Authorization: Bearer vd_…` | Dem Typ des [API-Tokens](#api-tokens) | REST, GraphQL, Echtzeit |
| Angemeldeter Endnutzer | `Authorization: Bearer <JWT>` | Seiner [Endnutzer-Rolle](#endnutzer) | REST, GraphQL, Echtzeit |

Standardmäßig ist alles geschlossen: Die Content-API antwortet mit `403`, bis du Zugriff
gewährst, und ein Admin kann nur, was seine Rollen erlauben.

## Admin-Rollen

Ein Admin hat eine oder mehrere Rollen; ihre Berechtigungen addieren sich. Drei Rollen sind
eingebaut:

| Rolle | Kann |
| --- | --- |
| **Super Admin** | Alles, auch Benutzer, Rollen und API-Tokens. Lässt sich nicht bearbeiten. |
| **Editor** | Alle Inhalte lesen, anlegen, ändern, löschen und veröffentlichen; die Medienbibliothek nutzen; Deploys auslösen; SEO, Weiterleitungen, Menüs und Formulare verwalten. |
| **Author** | Inhalte anlegen und nur die selbst angelegten Einträge lesen, ändern und löschen. Kann nicht veröffentlichen. Lädt Dateien hoch und bearbeitet oder löscht nur die eigenen. |

Weitere Rollen legst du unter **Einstellungen → Rollen** an (Berechtigung `roles.manage`). Der
letzte aktive Super Admin kann weder deaktiviert noch gelöscht noch herabgestuft werden, damit
sich die Instanz nie selbst aussperrt. Eine Rolle kann von ihren Mitgliedern außerdem
[Zwei-Faktor-Authentifizierung](/de/guides/auth/two-factor/) verlangen: Bis sie eingerichtet
ist, erreichen sie nur ihr Profil.

### Was eine Berechtigung ist

Eine Berechtigung besteht aus einer **Aktion**, bei Content-Aktionen einem **Objekt** und
optionalen **Bedingungen**:

- **Content-Aktionen**: `content.read`, `content.create`, `content.update`,
  `content.delete` und `content.publish`, auf einem Inhaltstyp (`api::article`) oder auf allen
  (`*`).
- **Medienaktionen**: `media.read`, `media.create`, `media.update` und `media.delete` für die
  Medienbibliothek.
- **Einstellungsaktionen** wie `users.manage`, `tokens.manage`, `webhooks.manage` oder
  `features.manage`, die die passenden Seiten unter **Einstellungen** öffnen.
- **Bedingungen**: `is-creator` beschränkt eine Content- oder Medienberechtigung auf das, was
  der Admin angelegt hat. So funktioniert die Rolle Author.

Bedingungen werden Teil der Datenbankabfrage: Eine per `is-creator` gefilterte Liste zählt und
paginiert korrekt, statt Zeilen nachträglich auszublenden.

### Feld- und Sprachberechtigungen

Content-Berechtigungen lassen sich weiter einschränken:

- **Felder.** `content.read`, `content.create` und `content.update` können die Attribute
  aufführen, die sie abdecken. Felder außerhalb der Liste sind beim Lesen verborgen (auch bei
  Suche, Filtern, Sortieren und verknüpften Einträgen) und werden beim Schreiben abgelehnt.
- **Sprachen.** Bei [lokalisierten Typen](/de/concepts/internationalization/) können
  Content-Berechtigungen die Sprachen aufführen, die sie abdecken. Versionen in anderen
  Sprachen lassen sich weder lesen noch ändern.

Beides stellst du pro Inhaltstyp im Editor der Rolle unter **Felder** und **Sprachen** ein.

## Content-API

Aufrufer der Content-API werden gegen Berechtigungen geprüft: eine **Aktion** auf einem
**Objekt**.

| Aktion | Erlaubt |
| --- | --- |
| `find` | Dokumente auflisten (`GET /api/articles`) oder einen Single Type lesen. |
| `findOne` | Ein Dokument lesen (`GET /api/articles/{documentId}`). |
| `create` | `POST` |
| `update` | `PUT` |
| `delete` | `DELETE` |
| `publish` | Die Routen `actions/publish`, `actions/unpublish` und `actions/discard-draft`. |
| `readDrafts` | Lesen mit `status=draft`. |

Objekte sind Inhaltstypen, die Medienbibliothek (`plugin::upload`) und Endnutzer-Konten
(`plugin::users-permissions.user`), wenn [Endnutzer](/de/guides/auth/end-users/) eingeschaltet
sind.

Ein paar Regeln gelten für jeden Aufrufer:

- Entwürfe zu lesen braucht neben `find` oder `findOne` auch `readDrafts`. Eine Berechtigung,
  die die Inhalte deiner Website liest, kann also nicht versehentlich unveröffentlichte Arbeit
  lesen.
- Populate, Filtern oder Sortieren über eine Relation braucht Lesezugriff auf ihren Zieltyp.
- `private` Felder werden nie zurückgegeben, egal welche Berechtigungen bestehen.
- Ein Schreibvorgang liefert das geschriebene Dokument auch ohne `find` zurück, wie in Strapi.
- Dieselben Berechtigungen gelten für [GraphQL](/de/api/graphql/) und den
  [Echtzeit-Stream](/de/api/realtime/).

### Öffentlicher Zugriff

Anfragen ohne `Authorization`-Header bekommen die Berechtigungen unter
**Einstellungen → Öffentlicher Zugriff**. Standardmäßig ist nichts freigegeben. Üblich sind
`find` und `findOne` auf den Typen, die deine Website anzeigt.

### API-Tokens

API-Tokens sind für Server, Build-Schritte und Skripte gedacht. Du legst sie unter
**Einstellungen → API-Tokens** an (Berechtigung `tokens.manage`):

| Typ | Berechtigungen |
| --- | --- |
| **Nur lesen** | `find` und `findOne` auf jedem Typ. Nie Entwürfe. |
| **Vollzugriff** | Jede Aktion auf jedem Typ, Entwürfe eingeschlossen. |
| **Benutzerdefiniert** | Die Berechtigungen, die du auswählst, wie beim öffentlichen Zugriff. |

- Ein Token beginnt mit `vd_`. Sein Secret wird einmal angezeigt, beim Anlegen oder
  Neugenerieren; Verdin speichert nur einen verschlüsselten Hash davon.
- Tokens können ablaufen. Ein unbekanntes, abgelaufenes oder fehlerhaftes Token ergibt `401`:
  Es fällt nie auf öffentlichen Zugriff zurück.
- Jedes gültige Token kann das OpenAPI-Dokument unter `/api/_openapi.json` lesen, sofern du
  die Dokumentation nicht öffentlich machst.

Wie du sie anlegst und rotierst, steht unter [API-Tokens](/de/guides/auth/api-tokens/).

### Endnutzer

Endnutzer sind die Menschen, die sich auf deiner Website oder in deiner App anmelden, wie beim
users-permissions-Plugin von Strapi. Die Funktion ist standardmäßig aus. Jedes Konto hat eine
Rolle:

- **Public** ist die Rolle von Anfragen ohne Token: Ihre Berechtigungen sind die unter
  **Einstellungen → Öffentlicher Zugriff**.
- **Authenticated** bekommen neue Konten standardmäßig.
- Eigene Rollen enthalten beliebige Berechtigungen, mit denselben Aktionen wie oben.

Ein Endnutzer schickt das JWT, das er bei der Anmeldung bekommen hat, als
`Authorization: Bearer <jwt>`. Verdin unterscheidet es von API-Tokens am Präfix `vd_`. Siehe
[Endnutzer](/de/guides/auth/end-users/).

## Im Vergleich zu Strapi

Das Modell folgt Strapi v5: Admin-RBAC mit `is-creator`-Bedingungen und eine Content-API mit
öffentlichem Zugriff, API-Tokens und users-permissions-Rollen. Die Unterschiede:

- Jede Funktion steht jedem Projekt zur Verfügung: eigene Rollen, Feld- und
  Sprachberechtigungen, [SSO](/de/guides/auth/sso/) und
  [Audit-Logs](/de/guides/content/audit-logs/).
- Entwürfe über die Content-API zu lesen ist eine eigene Berechtigung, `readDrafts`.
- Veröffentlichen über REST hat eine eigene Berechtigung, `publish`, und eigene Routen.
