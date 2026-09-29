---
title: Painel de administração
description: Como o painel de administração Angular do Verdin é estruturado, como ele monta formulários e listas a partir do schema, e como é construído, embutido no binário e traduzido.
sidebar:
  order: 6
  label: Painel de administração
---

Esta página é para quem contribui com o painel de administração em `admin/`: como o app Angular é organizado, como ele transforma o schema de conteúdo em formulários e listas, e como ele acaba dentro do binário `verdin`. Como usar o painel é assunto dos guias; como funciona o lado do servidor da API de administração está na [referência da API de administração](/pt-br/api/admin/).

O painel é uma single-page app em Angular 22: componentes standalone, detecção de mudanças zoneless, signals, rotas com lazy loading e componentes spartan/ui sobre o Tailwind CSS v4.

## Estrutura

```text
admin/
├── src/app/
│   ├── app.config.ts     # providers: router, HttpClient interceptors, Transloco, icons
│   ├── app.routes.ts     # lazy routes, guards (auth, permissions, unsaved changes)
│   ├── core/             # services and pure models: api, auth, schema, i18n, permissions…
│   ├── layout/           # the shell (sidebar, header), home, deploy button
│   ├── features/
│   │   ├── auth/         # login, first admin, invitations, password reset
│   │   ├── dashboard/    # home widgets
│   │   ├── content/      # lists, the entry editor, history, releases, review, import
│   │   │   ├── fields/   # schema-driven form controls and the form model
│   │   │   └── collab/   # comments and tasks
│   │   ├── builder/      # content-type builder (verdin dev only)
│   │   ├── media/        # media library
│   │   ├── releases/
│   │   ├── profile/      # own account, two-factor, passkeys, sessions
│   │   └── settings/     # users, roles, tokens, webhooks, locales, plugins, site features…
│   └── shared/
│       ├── ui/           # spartan helm components, owned by the project
│       └── components/   # app-level shared components (confirm dialog, page header…)
├── public/i18n/          # translation catalogs, one JSON file per language
├── scripts/check-i18n.mjs
└── e2e/                  # Playwright tests and the server they run against
```

O **estado** fica em signals dentro de serviços injetáveis em `core/` (`Auth`, `Schema`, `I18n`, `Theme`…). Não há biblioteca de store.

O **acesso à API** passa por `core/api.ts`, um pequeno wrapper baseado em promises sobre o `HttpClient` do Angular, com tipos escritos à mão em `core/types.ts`. A configuração de runtime (caminho da administração, prefixo da API, modo, branding) vem de uma tag `<meta name="verdin-config">` que o servidor injeta.

**Sessão.** O token de acesso fica apenas em memória; o token de renovação é um cookie `HttpOnly` restrito às rotas de autenticação. Um interceptor HTTP adiciona o bearer token e, em um `401`, renova uma vez e tenta de novo; se a renovação falhar, ele manda o usuário para a página de login. As requisições de renovação e de logout levam o cabeçalho `X-Verdin-CSRF` que o servidor exige. Os guards restauram a sessão a partir do cookie ao carregar a página. Um `403` que diz que a função exige autenticação de dois fatores manda o usuário configurá-la.

## Formulários guiados pelo schema

O editor de entradas (`features/content/edit.ts`) não tem código por tipo. Ele lê os tipos de conteúdo e os componentes de `GET /admin/api/content-types` e `GET /admin/api/components`, e o layout do editor das configurações da tela de edição, e monta o formulário em runtime com **Signal Forms** (`@angular/forms/signals`):

- O modelo do documento é um signal de um objeto simples (`FormModel` em `fields/model.ts`); a árvore de campos e os seus validadores são derivados do schema.
- Um componente recursivo `vd-fields` (`fields/fields.ts`) renderiza qualquer mapa de atributos contra uma árvore de campos. Textos, datas e horas usam inputs nativos vinculados com `[formField]`. `FormValueControl`s personalizados tratam números (anuláveis; os inteiros grandes continuam strings), interruptores, enumerações, datas com hora (hora local no input, UTC no modelo), JSON, Markdown, `blocks` (TipTap), mídia, relações (seletor com busca enquanto se digita e ordenação) e relações polimórficas.
- Os componentes são fieldsets aninhados; os componentes repetíveis e as zonas dinâmicas são listas reordenáveis. Os plugins podem registrar tipos de campo personalizados, renderizados como custom elements.
- `toModel` converte um documento populado no modelo do formulário (as relações viram `documentId`s, os arquivos viram ids), e `toPayload` converte de volta no payload `data`: as strings vazias viram `null`, e as chaves de renderização (`__key`) e os lados somente leitura (`mappedBy`, `morphOne`, `morphMany`) são descartados. Os dois têm testes unitários em `fields/model.spec.ts`.
- A validação derivada do schema dá retorno imediato. Os campos condicionais (`conditions.visible`) são avaliados no navegador por um port do avaliador JSON Logic do servidor (`core/logic.ts`). As regras de validação entre campos são verificadas apenas pelo servidor. O servidor continua sendo a autoridade: as suas entradas `details.errors[].path` são mapeadas de volta para o campo correspondente.
- Salvar é explícito, com rastreamento de alterações e um aviso ao sair da página (um route guard mais `beforeunload`). Os botões **Publicar**, **Despublicar** e **Descartar alterações** aparecem conforme o estado do documento. A administração salva apenas rascunhos; publicar é sempre uma ação separada.

O layout do editor (ordem dos campos, larguras, rótulos, descrições, campos somente leitura, o campo que nomeia as entradas relacionadas) é compartilhado por todos os administradores e armazenado no servidor em `vd_settings`, alterado na página **Configurar a visualização** com a permissão `views.manage`.

## Listas

As listas de conteúdo (`features/content/list.ts`) usam a tabela helm do spartan com paginação, ordenação e filtros no servidor. Os filtros, a busca (`_q`) e a página são espelhados na URL, então uma lista filtrada é um link compartilhável. Cada administrador escolhe as colunas visíveis, a ordenação padrão e o tamanho da página por tipo (`list-view.ts`); essas escolhas são salvas nas suas próprias preferências no servidor, então elas o acompanham entre navegadores. As listas também se atualizam ao vivo a partir do stream de eventos da administração.

## Construtor de tipos de conteúdo

O **Construtor de tipos de conteúdo** só fica visível quando o servidor roda em modo de desenvolvimento (`verdin dev`) e o administrador tem `schema.manage`. Ele edita os tipos de conteúdo e os componentes no seu formato de arquivo: campos, tipos e destinos de relação (criando o atributo inverso no destino), componentes, zonas dinâmicas, comprimentos, intervalos e as flags `required`, `unique` e `private`.

Toda alteração é enviada primeiro para `POST /admin/api/schema/plan`, que valida o schema resultante e retorna os passos da migração com o seu risco, o seu SQL e as sugestões de renomeação que o usuário pode aceitar. Confirmar chama `POST /admin/api/schema/apply` com o nível de risco aceito e as renomeações. O servidor migra, grava `schema/*.json` e troca o app em execução pelo novo schema sem reiniciar. Veja o [motor de migrações](/pt-br/internals/migrations/) para o que acontece no servidor.

## Build e distribuição

- `ng build` grava o build de produção em `admin/dist/admin/browser`, com `<base href="/admin/">`.
- O servidor embute essa pasta com `rust-embed` quando compilado com a feature `embed-admin`, que os builds de release e a imagem Docker usam. Sem a feature, ou quando `[admin].assets_dir` está definido, ele serve os arquivos a partir do disco. `assets_dir` prevalece sobre o build embutido.
- O servidor reescreve o `<base href>` para `[admin].path` e injeta a configuração de runtime como uma tag `<meta>`, não como um script inline. Mudar `admin.path` nunca exige reconstruir o painel.
- Os caminhos desconhecidos sem extensão de arquivo recaem para `index.html`, para o roteamento no cliente. Os bundles com fingerprint (`main-ABC123.js`) ficam em cache como `immutable` por um ano; todo o resto é `no-cache`.
- Toda resposta da administração leva uma Content Security Policy estrita (`script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`…), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` e `Referrer-Policy: strict-origin-when-cross-origin`. O inlining de CSS crítico do Angular fica desativado no `angular.json`, porque depende de handlers de evento inline que a política proíbe.

Para trabalhar no frontend, rode o servidor e depois `npm start` em `admin/`: o `ng serve` faz proxy de `/admin/api` e `/api` para `http://localhost:1337` (`admin/proxy.conf.json`).

## Traduções

O painel é traduzido em runtime com o Transloco, não com o i18n em tempo de compilação do Angular, então um único build serve todos os idiomas e os usuários podem trocar sem recarregar.

- Os catálogos são arquivos JSON planos em `admin/public/i18n/` (`en.json` é a fonte), carregados sob demanda.
- As mensagens usam ICU MessageFormat (`{name}`, `{count, plural, one {# entry} other {# entries}}`), interpretadas pelo FormatJS (`intl-messageformat`) por meio de um transpiler personalizado do Transloco. O FormatJS interpreta as mensagens em vez de compilá-las em funções, então a CSP não precisa de `unsafe-eval`.
- As chaves das mensagens são tipadas a partir do `en.json` (`core/i18n/keys.ts`): usar uma chave que não existe é um erro de compilação.
- `npm run i18n:check` verifica todos os catálogos contra o `en.json`: as mesmas chaves, sintaxe ICU válida, os mesmos argumentos e todas as categorias de plural do idioma. A CI o executa.
- O serviço `I18n` também fornece a formatação sensível ao idioma e o primeiro dia da semana, tirados das configurações regionais do navegador, com uma substituição por usuário.

Como adicionar ou atualizar um idioma está em [tradução](/pt-br/project/translating/).
