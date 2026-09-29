---
title: Registro de decisões
description: As decisões de design por trás do Verdin, numeradas na ordem em que foram tomadas, com o resultado e o motivo de cada uma.
sidebar:
  order: 8
---

Este registro guarda as escolhas de design que moldaram o Verdin, na ordem em que foram feitas, para que você entenda por que o código é como é antes de propor mudá-lo. As entradas são mantidas como foram escritas, incluindo os nomes dos marcos (M2–M4 são os marcos anteriores às primeiras versões); uma entrada posterior pode refinar uma anterior, como a 28 faz com a 1. Adicione uma nova linha quando tomar uma decisão que, de outra forma, alguém teria que deduzir do código.

| # | Decisão | Resultado | Justificativa |
|---|---|---|---|
| 1 | Componentes: JSON ou tabelas | **Coluna JSON** ([armazenamento](/pt-br/internals/storage/#componentes-e-zonas-dinâmicas-uma-coluna-json)) | Menos joins, publicação e versionamento triviais, migrações mais simples. Filtrar por componentes repetíveis é raro; pode ser adicionado depois com funções JSON |
| 2 | Codificação JSON de `decimal` | **número** por padrão, `api.decimal_as_string` opcional | A compatibilidade com o Strapi maximiza a adoção; os valores exatos ficam disponíveis quando necessário |
| 3 | Formulários da administração | **Signal Forms** | Combina com uma administração zoneless e baseada em signals; árvores de formulário dinâmicas derivadas do schema |
| 4 | Idioma | **Inglês** para código, documentação e commits | Alcance open source |
| 5 | Compatibilidade com o REST do Strapi | **Mesmos parâmetros e mesmo formato de resposta**; extensões exclusivas do Verdin em `actions/` | Os frontends migram com o mínimo de mudanças |
| 6 | Algoritmo do JWT de administração | HS256 | Um único segredo, simples; EdDSA se um dia surgirem verificadores externos |
| 7 | IDs de documento | ULID (26 caracteres) | Ordenáveis e portáveis; os próprios ids do Strapi são strings opacas de 24 caracteres, os clientes nunca os interpretam |
| 8 | Conteúdo do snapshot | Modelo físico, não o schema | As versões posteriores podem derivar novas tabelas a partir de um schema inalterado |
| 9 | Nulidade dos atributos | Sempre aceitam nulo; `required` verificado ao publicar | Os rascunhos podem estar incompletos (comportamento do Strapi v5); adicionar campos obrigatórios é seguro |
| 10 | Imposição do `unique` | Índice único em `(column, locale, publication_state)` | Sem condições de corrida; os rascunhos e a sua versão publicada compartilham valores |
| 11 | Nome da coluna de estado | `publication_state` | `state` é um nome de atributo comum |
| 12 | Palavras reservadas do SQL | Sempre colocar os identificadores entre aspas | Nenhuma lista arbitrária de nomes de atributos proibidos |
| 13 | Montagem de DML | Builder próprio em vez do `sea-query` | Os detalhes de cada dialeto predominam (NULLs tipados, collations, formatos do SQLite); uma abstração a menos |
| 14 | Escritas sem `?status=draft` | Publicam (comportamento REST do Strapi v5) | Compatibilidade direta com os clientes existentes |
| 15 | Comparação de texto | Exata por padrão em todos os motores; operadores `…i` para ignorar maiúsculas | Os mesmos resultados no MySQL e no PostgreSQL |
| 16 | Controle de acesso temporário (M2–M3) | Interruptor `[api].open_access`, removido na M4 | Seguro por padrão até as permissões existirem |
| 17 | "O destino pertence a um documento" | Imposto movendo o destino, por estado | Um índice único impediria que um rascunho e a sua versão publicada compartilhassem um destino |
| 18 | Lados inversos (`mappedBy`) | Somente leitura | Escrever por eles é ambíguo com rascunho e publicação (qual versão do dono?) |
| 19 | Posições dos vínculos | Renumeradas de 1 a n a cada escrita | Sem esgotamento de floats; as listas são pequenas |
| 20 | Linhas das tabelas de vínculos | Manter uma chave primária `id` | Tabelas uniformes para o motor de migrações e as reconstruções do SQLite |
| 21 | Biblioteca de JWT | HS256 próprio (HMAC-SHA256, verificação em tempo constante, `alg` fixado) | O `jsonwebtoken` 11 precisa de um backend de criptografia que puxa RSA |
| 22 | Tabelas da plataforma | Derivadas junto com o modelo de conteúdo | Um único mecanismo de migração para tudo |
| 23 | Reutilização do token de renovação | Revoga a família inteira, sem janela de tolerância | Simples e estrito; o administrador faz login de novo |
| 24 | Rascunhos pela API de conteúdo | Permissão `readDrafts` separada | Os tokens que leem o conteúdo publicado não vazam rascunhos |
| 25 | Ordem de aplicação do construtor | Migra, depois grava os arquivos, depois troca o app a quente | Uma migração que falha deixa os arquivos e o app em execução intactos |
| 26 | Escritas da administração | Salvam apenas rascunhos; publicar é uma ação explícita | Corresponde à expectativa dos editores; a API de conteúdo mantém a publicação por padrão do Strapi |
| 27 | Configuração de runtime da administração | Tag `<meta>`, não script inline | Mantém a CSP livre de scripts `unsafe-inline` |
| 28 | Filtros em campos de componentes | Operadores de caminho JSON por dialeto (`#>>`, `JSON_VALUE`, `json_extract`); `EXISTS` sobre os itens dos arrays para componentes repetíveis e zonas dinâmicas (0.8) | As zonas dinâmicas só por `__component`: os seus itens têm campos diferentes |
| 29 | i18n da administração | Transloco com catálogos JSON planos (`admin/public/i18n`) e ICU MessageFormat via FormatJS (um transpiler personalizado), atrás de uma pequena fachada `I18n`; não o i18n em tempo de compilação do Angular | Troca de idioma em runtime; arquivos padrão para Weblate/Crowdin; o FormatJS interpreta as mensagens, então a CSP estrita não precisa de `unsafe-eval` (o `@messageformat/core` compila com `new Function`); chaves tipadas a partir do `en.json`, completude verificada por `npm run i18n:check` |
| 30 | Início da semana | `Intl.Locale#getWeekInfo` da tag regional do navegador (en-GB ≠ en-US), com uma tabela de regiões como fallback e substituição pelo usuário | Segue a região de cada usuário mesmo quando o idioma da interface é compartilhado |
| 31 | Armazenamento do layout do dashboard | Coluna JSON `preferences` por usuário em `vd_admin_users` (≤ 64 KiB) | Acompanha o usuário entre navegadores; o tema e o idioma ficam no `localStorage` porque se aplicam antes do login |
| 32 | Padrão `Secure` do cookie de renovação | Ativado em `start`, desativado em `dev`, configurável | O `verdin dev` via HTTP simples funciona em todos os navegadores; a produção continua estrita |
| 33 | Perfil de release | Thin LTO, 1 codegen unit, stripped; unwinding mantido | Um handler que entra em panic não pode derrubar o servidor |
| 34 | Documentos "não vistos" | Linhas `vd_document_views` por usuário, excluídas para todos menos o editor quando um documento muda; filtradas com `NOT EXISTS` no SQL | A paginação e as contagens continuam exatas; nenhum timestamp a comparar por linha |
| 35 | Votos e enquetes | Tabelas de colaboração exclusivas da administração (`vd_document_votes`, `vd_polls`, `vd_poll_votes`), para qualquer tipo de conteúdo | Caixas de sugestões e decisões de equipe sem modelar campos de voto em todos os schemas |
| 36 | Armazenamento de mídia | `object_store` para local e S3 | Um único caminho de código; uploads multipart em streaming; RustFS no ambiente de desenvolvimento e na CI |
| 37 | Vínculos de mídia | Tabelas de vínculos por campo, como as relações | A mesma semântica de rascunho e publicação das relações; as cascatas mantêm os vínculos consistentes |
| 38 | Atualizações das permissões integradas | Marcador de versão em `vd_settings`, adições aplicadas uma única vez | As instalações existentes ganham as novas permissões sem desfazer as edições posteriores de um administrador |
| 39 | Recursos em runtime | Catálogo no `verdin-api`, interruptores em `vd_settings` (`features`), o app reconstruído no lugar (ArcSwap) em todos os modos | Interruptores de plugins como no Strapi, sem reinicializações; os recursos indisponíveis são listados com a versão planejada |
| 40 | Interface da referência da API | Scalar (`scalar_api_reference`, bundle embutido) em `{api}/docs`, apenas quando o documento é público; a CSP permite o seu bootstrap inline por hash | Auto-hospedado (sem CDN, fontes, agente de IA nem telemetria); o documento continua exigindo token por padrão |
| 41 | GraphQL | Schema dinâmico do `async-graphql` montado com o app; os argumentos e as seleções são traduzidos para a árvore de parâmetros REST e interpretados pelo mesmo parser de consultas | Um único conjunto de regras para filtros, paginação, populate, validação e permissões entre REST e GraphQL; o populate derivado da seleção mantém o carregamento em lote |
| 42 | Eventos de documentos | Listeners no Document Service, chamados após o commit | Os efeitos colaterais (marcas de visto, futuros webhooks) se aplicam a todas as APIs sem hooks por handler |
