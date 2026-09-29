---
title: Sécurité
description: Comment Verdin protège le panneau d’administration, l’API de contenu et le serveur, quels paramètres renforcent une instance de production, et comment signaler une vulnérabilité.
sidebar:
  order: 2
---

Cette page décrit ce que fait Verdin pour protéger un projet et les paramètres que vous
contrôlez. Utilisez-la avec la [check-list de production](/fr/deploy/production-checklist/)
quand vous préparez une instance pour du vrai trafic.

## Ce qui est fermé par défaut

- **L’API de contenu.** Les requêtes anonymes n’obtiennent rien tant que vous n’accordez pas
  d’autorisations publiques dans **Paramètres → Accès public**. Un jeton inconnu, expiré ou mal
  formé donne un `401`, jamais un repli sur le rôle public. Voir
  [Autorisations](/fr/concepts/permissions/).
- **Le document OpenAPI** sur `/api/_openapi.json` nécessite un jeton d’API valide tant que vous
  ne le rendez pas public dans **Paramètres → Fonctionnalités → Documentation de l’API**.
- **Les fonctionnalités facultatives** comme GraphQL, les utilisateurs finaux, le SSO et le
  serveur MCP restent désactivées tant qu’un administrateur disposant de l’autorisation
  `features.manage` ne les active pas dans **Paramètres → Fonctionnalités**.
- **Les plugins** restent désactivés tant qu’un administrateur n’active pas chacun d’eux dans
  **Paramètres → Plugins**.
- **Les appels cross-origin depuis un navigateur.** Aucune origine ne peut appeler une API
  depuis un navigateur tant que vous ne la listez pas dans `[api].cors_origins`.

## Connexion à l’administration

| Protection | Détails |
| --- | --- |
| Hachage des mots de passe | Argon2id avec les paramètres de l’OWASP, avec un nouveau hachage quand ils changent. |
| Sessions | Un jeton d’accès de 15 minutes gardé dans la mémoire de la page (jamais dans `localStorage`), et un jeton de rafraîchissement de 30 jours dans un cookie `HttpOnly`, `SameSite=Strict` limité à `/admin/api/auth`. Le jeton de rafraîchissement est renouvelé à chaque utilisation ; présenter un ancien jeton met fin à toute la session. |
| Cookies sécurisés | Le cookie de rafraîchissement est `Secure` sous `verdin start`. `[admin].secure_cookies = false` désactive ce comportement et journalise un avertissement. |
| CSRF | Le rafraîchissement et la déconnexion nécessitent un en-tête `X-Verdin-CSRF`, qu’un formulaire intersite ne peut pas envoyer. |
| Verrouillage | Cinq tentatives échouées verrouillent un compte pendant 15 minutes. Les échecs sont comptés sur les étapes du mot de passe et du second facteur. Les e-mails inconnus et les mauvais mots de passe reçoivent la même réponse, dans le même délai. |
| Limite de débit | Connexion, inscription et rafraîchissement : `[admin].auth_rate_limit` requêtes par minute et par adresse client (20). |
| Second facteur | Applications d’authentification (TOTP) et passkeys, avec des codes de récupération. Un rôle peut l’exiger (`requireTwoFactor`). Voir [Authentification à deux facteurs](/fr/guides/auth/two-factor/). |
| Super Admins | Seul un Super Admin peut créer, modifier, supprimer ou réinitialiser un Super Admin, ou attribuer ce rôle. Le dernier Super Admin actif ne peut pas être retiré. |

Le premier administrateur se crée via le panneau tant qu’aucun administrateur n’existe.
Faites-le juste après le premier démarrage, ou créez-le avec `verdin admin create --email …`
avant d’exposer le serveur.

## Panneau et API d’administration

- L’API d’administration (`/admin/api`) n’envoie aucun en-tête CORS, quoi que dise
  `[api].cors_origins` : les navigateurs ne laissent que l’origine du panneau lire ses réponses.
- Le panneau est servi avec une Content Security Policy stricte (scripts de sa propre origine
  uniquement), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` et
  `Referrer-Policy: strict-origin-when-cross-origin`.
- Verdin n’envoie pas `Strict-Transport-Security`. Ajoutez-le au niveau du reverse proxy qui
  termine le TLS.

## API de contenu

- Les **jetons d’API** ne sont affichés qu’une fois. Verdin stocke un HMAC-SHA256 de chaque
  jeton, calculé avec `VERDIN_TOKEN_PEPPER`, et garde un préfixe de 10 caractères pour
  l’affichage. Les jetons peuvent expirer et être régénérés.
- Les **autorisations par champ et par langue** limitent ce qu’un rôle lit et écrit, et
  `populate`, les filtres et les tris à travers les relations n’atteignent que les types que
  l’appelant peut lire.
- **Limites de requête** : `pageSize` jusqu’à `[api].max_page_size` (100), profondeur de
  `populate` jusqu’à 5, au plus 100 conditions de filtre, des chaînes de requête jusqu’à
  16 Ko, et au plus 1 000 entrées peuplées par relation. Des champs inconnus ou privés dans une
  requête donnent un `400`.
- **GraphQL** a ses propres limites de profondeur et de complexité (`maxDepth`,
  `maxComplexity`) et un interrupteur d’introspection dans les paramètres de la fonctionnalité.
- **Limites de débit** : `[api].public_rate_limit` par adresse client sans jeton et
  `[api].token_rate_limit` par jeton d’API ou utilisateur final, en requêtes par minute. Les deux
  sont désactivées (`0`) par défaut. Les requêtes avec un jeton bearer inconnu sont limitées par
  adresse.

### CORS

`[api].cors_origins` liste les origines de navigateur autorisées à appeler l’API de contenu et
GraphQL :

```toml title="verdin.toml"
[api]
cors_origins = ["https://www.example.com", "https://preview.example.com"]
```

Chaque entrée est de la forme `scheme://host[:port]`, sans chemin ni barre oblique finale ;
`["*"]` autorise toutes les origines et ne peut pas être combiné avec d’autres. Les méthodes
autorisées sont `GET`, `POST`, `PUT` et `DELETE`, et les en-têtes de requête autorisés
`Authorization`, `Content-Type` et `If-None-Match`. Le démarrage échoue sur une entrée qui n’est
pas une origine.

Les frontends côté serveur (Astro, Next.js côté serveur) appellent l’API sans navigateur et
n’ont besoin d’aucune entrée CORS.

## Requêtes et téléversements

| Paramètre | Valeur par défaut | Protège contre |
| --- | --- | --- |
| `[server].body_limit` | `"1mb"` | Les corps de requête volumineux sur les API ordinaires. |
| `[server].request_timeout_secs` | `30` | Les requêtes lentes qui monopolisent des connexions. |
| `[upload].max_file_size` | 200 Mo | Les téléversements volumineux (les téléversements ont leur propre limite au lieu de `body_limit`). |
| `[upload].max_image_megapixels` | `100` | Les bombes de décompression. |

Le type d’un fichier téléversé est déterminé à partir de ses octets, et non du type envoyé par
le client ; le nom du fichier ne sert que de solution de repli, et jamais pour les types que les
navigateurs exécutent activement (ces fichiers sont stockés en `application/octet-stream`). Les
liens du texte enrichi `blocks` doivent être en `http(s)`, `mailto:` ou relatifs.

## Adresses des clients derrière un proxy

Les limites de débit et les journaux d’audit utilisent l’adresse du client. Derrière un reverse
proxy, toutes les requêtes proviennent du proxy : listez donc le proxy dans
`[server].trusted_proxies` :

```toml title="verdin.toml"
[server]
trusted_proxies = ["10.0.0.0/8"]   # the proxies' IPs or CIDR ranges
```

Verdin lit alors `X-Forwarded-For` de droite à gauche et prend la première adresse qui n’est pas
un proxy de confiance. Les requêtes provenant de toute autre adresse gardent leur adresse de
connexion : un client ne peut donc pas falsifier son adresse en envoyant lui-même l’en-tête. Ne
listez pas de plages depuis lesquelles des clients non fiables peuvent se connecter.

## Requêtes sortantes

Les webhooks, les hooks de déploiement, les webhooks de purge du CDN et les téléversements
depuis une URL effectuent des requêtes choisies par un administrateur. Sous `verdin start`, ils
refusent les adresses de bouclage, privées et link-local (y compris les formes IPv6 qui
embarquent des adresses IPv4 privées) : un administrateur ne peut donc pas s’en servir pour
atteindre des services de votre réseau interne. `[webhooks].allow_private_networks = true` lève
cette restriction ; ne le faites que si tous les administrateurs sont dignes de confiance vis-à-vis
du réseau interne.

## Secrets

`VERDIN_ADMIN_JWT_SECRET` et `VERDIN_TOKEN_PEPPER` sont lus uniquement depuis l’environnement et
doivent chacun faire au moins 32 octets (`verdin secrets` en affiche de nouveaux). Le pepper
scelle aussi les secrets TOTP des administrateurs et sert à dériver la clé qui hache les adresses
des personnes qui soumettent des formulaires. Stockez les deux dans le gestionnaire de secrets de
votre plateforme et ne commitez jamais `.env`.

Les logs de requêtes masquent les valeurs des paramètres de requête dont le nom semble secret
(`token`, `code`, `password`, `key`, `signature`…) et la partie secrète des URL de callback de
déploiement.

## Métriques

`/_metrics` est désactivé sauf si `[metrics].enabled = true`. Quand il est activé et qu’aucun
jeton n’est défini, quiconque atteint le port peut le lire. Définissez `VERDIN_METRICS_TOKEN`
(ou `[metrics].token`) et collectez avec `Authorization: Bearer <token>`, ou bloquez le chemin
au niveau du proxy. Voir [Supervision](/fr/deploy/monitoring/).

## Plugins

Les plugins sont des modules WebAssembly exécutés par Extism dans un bac à sable. Un module n’a
ni système de fichiers, ni réseau, ni base de données propres : tout passe par des fonctions
hôtes limitées par les capacités de son `plugin.toml` (types de contenu qu’il lit ou écrit, hôtes
HTTP, son propre stockage clé-valeur), avec une limite de temps et de mémoire par appel
(`[limits]`, 5 s et 64 Mo dans le manifeste d’exemple). Les administrateurs voient ce que demande
un plugin avant de l’activer. Les scripts d’administration des plugins s’exécutent dans la page
du panneau : n’installez donc que des plugins de confiance. Voir
[Plugins](/fr/extending/plugins/).

## Exports et sauvegardes

Les archives de `verdin export` contiennent les champs privés et les hachages de mots de passe.
Stockez-les comme des dumps de base de données. Voir [Sauvegardes](/fr/deploy/backups/).

## Signaler une vulnérabilité

N’ouvrez pas d’issue publique pour un problème de sécurité. Suivez la
[politique de sécurité](https://github.com/Verdin-CMS/verdin/blob/main/SECURITY.md) du dépôt :
signalez-le en privé via l’onglet **Security** du
[dépôt](https://github.com/Verdin-CMS/verdin/security) (**Report a vulnerability**), avec la
version, les étapes pour reproduire le problème et l’impact que vous constatez. Les correctifs
de sécurité sont listés sous **Security** dans le [changelog](/fr/project/changelog/).
