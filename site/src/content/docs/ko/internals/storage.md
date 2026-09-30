---
title: 스토리지
description: 테이블 이름과 시스템 컬럼부터 초안·게시 행, 관계 링크, 컴포넌트 JSON, 플랫폼 테이블까지 Verdin이 데이터베이스에 콘텐츠를 배치하는 방식.
sidebar:
  order: 2
---

이 페이지에서는 Verdin이 스키마에서 도출하는 테이블과 각 종류의 속성이 저장되는 방식을 설명합니다. `crates/verdin-migrate/src/derive.rs`나 Document Service의 무언가를 바꾸기 전에, 또는 데이터베이스를 직접 조회해야 할 때 읽으세요. 각 속성 타입이 받는 값은 [속성 타입](/ko/reference/attribute-types/)을 참고하세요.

이 테이블들은 절대 직접 쓰지 않습니다. [마이그레이션 엔진](/ko/internals/migrations/)이 스키마에서 만들고 발전시킵니다.

## 이름 규칙

| 대상 | 이름 |
|---|---|
| 콘텐츠 타입 테이블 | `collectionName`. 기본값은 대시를 밑줄로 바꾼 `pluralName`(`blog-posts` → `blog_posts`) |
| 컬럼 | snake case로 바꾼 속성 이름(`metaTitle` → `meta_title`) |
| 관계 링크 | `{table}_{column}_lnk` |
| 다형성 관계 링크 | `{table}_{column}_mph` |
| 미디어 링크 | `{table}_{column}_mda` |
| 인덱스 | 고유 인덱스는 `{table}_{part}_uq`, 그 밖에는 `{table}_{part}_idx` |
| 플랫폼 테이블 | `vd_` 접두사(`vd_admin_users`, `vd_schema_snapshots`…) |

스키마 검증기가 강제하는 규칙(`crates/verdin-schema/src/naming.rs`와 `validate.rs`):

- `collectionName`은 `^[a-z][a-z0-9_]*$`에 맞고, 최대 50자이며, `vd_`로 시작할 수 없습니다.
- `singularName`과 `pluralName`은 kebab case입니다(`^[a-z][a-z0-9-]*$`, 앞뒤나 연속 대시 불가). `upload`, `uploads`, `auth`, `users`, `connect`는 콘텐츠 API가 그 라우트를 쓰므로 예약되어 있습니다.
- 속성 이름은 문자로 시작하고 문자, 숫자, 밑줄이 이어지며(Strapi의 규칙), 최대 50자입니다.
- 콘텐츠 타입에서는 `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`가 예약되어 있고, snake case가 이들과 충돌하는 이름도 마찬가지입니다. 컴포넌트에서는 `id`가 예약되어 있습니다.
- 생성된 식별자는 최대 60자입니다(PostgreSQL은 63, MySQL은 64 허용). 더 긴 이름은 잘라 내고 전체 이름의 8자 해시를 붙이므로, 서로 다른 긴 이름은 계속 구분되고 결과는 결정적입니다.

생성된 SQL에서 모든 식별자를 인용하므로 SQL 예약어도 올바른 속성 이름입니다.

## 시스템 컬럼

모든 콘텐츠 타입 테이블은 다음 컬럼으로 시작합니다.

```sql
id                 BIGINT       primary key, auto-increment
document_id        CHAR(26)     NOT NULL           -- ULID, shared by every version of a document
locale             VARCHAR(16)  NOT NULL DEFAULT '' -- '' for types that are not localized
publication_state  SMALLINT     NOT NULL           -- 0 = draft, 1 = published
published_at       <datetime>   NULL
created_at         <datetime>   NOT NULL
updated_at         <datetime>   NOT NULL
created_by_id      BIGINT       NULL               -- vd_admin_users.id
updated_by_id      BIGINT       NULL
UNIQUE (document_id, locale, publication_state)
INDEX  (publication_state, locale)
```

- `document_id`는 생성할 때 만드는 소문자 ULID입니다. 초안, 게시 버전, 모든 로케일에 걸쳐 같습니다.
- 로컬라이즈되지 않은 타입은 `NULL` 대신 `locale = ''`을 씁니다. 어떤 엔진에서도 고유 인덱스에서 NULL은 절대 충돌하지 않으므로 `(document_id, locale, publication_state)` 제약이 깨지기 때문입니다.
- 상태 컬럼은 `state`가 아니라 `publication_state`입니다. `state`는 흔한 속성 이름이기 때문입니다.

그 뒤에 스칼라 속성마다 속성 컬럼이 하나씩 옵니다. **모든 속성 컬럼은 nullable입니다.** Strapi v5처럼 초안은 불완전할 수 있으므로, `required`는 데이터베이스가 아니라 버전이 게시될 때(초안과 게시를 쓰지 않는 타입에서는 매번 쓸 때) 검사합니다. 그래서 필수 속성을 추가하는 것도 safe 마이그레이션입니다.

`unique` 속성과 모든 `uid`에는 `(column, locale, publication_state)`에 대한 고유 인덱스가 생깁니다. 초안과 그 게시 버전은 값을 공유할 수 있지만 두 게시 문서는 그럴 수 없으며, 데이터베이스가 경쟁 조건 없이 강제합니다. 위반은 그 필드에 대한 `ValidationError`로 보고됩니다.

## 초안과 게시

Verdin은 Strapi v5의 모델을 따릅니다. 사용자 관점은 [초안과 게시](/ko/concepts/draft-and-publish/)를 참고하세요. 여기서는 테이블에서 일어나는 일을 다룹니다.

- 문서는 로케일마다 초안 행(`publication_state = 0`)과 게시 행(`publication_state = 1`)을 최대 하나씩 가집니다.
- 관리자 패널의 쓰기는 초안 행을 대상으로 합니다.
- **게시**는 초안에 대해 `required` 속성과 검증 규칙을 검사한 뒤, 초안의 속성 값을 게시 행에 복사합니다(수정하거나, 처음이면 삽입). 트랜잭션 하나로 처리하며, 초안의 관계와 미디어 링크도 함께 복사합니다.
- **게시 취소**는 게시 행을 삭제합니다. 그 링크는 `ON DELETE CASCADE`로 함께 삭제됩니다.
- **초안 폐기**는 초안을 게시 행의 값과 링크로 덮어씁니다.
- 초안과 게시를 쓰지 않는 콘텐츠 타입에는 게시 행만 있습니다.
- 로컬라이즈된 타입에서 로컬라이즈되지 않은 속성은 공유됩니다. 한 로케일을 게시하면 다른 로케일의 게시 행으로 복사됩니다.

## 관계: 문서 id로 연결

**이것이 Strapi 스토리지와의 주요 차이입니다.** Strapi는 행 id로 행을 연결하므로 게시할 때 링크를 다시 써야 합니다. Verdin은 관계를 *원본 행 → 대상 문서*로 저장합니다.

```sql
-- articles_category_lnk
id                  BIGINT   primary key, auto-increment
source_id           BIGINT   NOT NULL REFERENCES articles(id) ON DELETE CASCADE
target_document_id  CHAR(26) NOT NULL
position            DOUBLE   NOT NULL   -- 1..n, rewritten on every write
UNIQUE (source_id, target_document_id)
UNIQUE (source_id)                      -- to-one kinds only
INDEX  (target_document_id)
```

- 대상 행은 읽을 때 읽고 있는 버전으로 정해집니다. 게시된 글은 게시된 카테고리를, 초안은 초안을 봅니다. 카테고리가 게시 취소되면 링크를 건드리지 않고 게시된 글에서 사라집니다.
- 게시는 원본 행 자신의 링크만 복사합니다.
- **소유** 쪽(`inversedBy`가 있는 속성, 또는 단방향 관계)에만 링크 테이블이 있습니다. 역방향 쪽(`mappedBy`)은 같은 테이블을 거꾸로 읽으며 읽기 전용입니다. 이쪽에 쓰면 소유 속성을 명시한 검증 오류가 납니다.
- "대상은 최대 하나"(`oneToOne`, `manyToOne`, `oneWay`)는 `source_id`에 대한 고유 인덱스입니다. "대상은 원본 문서 하나에 속함"(`oneToOne`, `oneToMany`)은 인덱스로 만들 수 없습니다. 초안과 그 게시 버전이 정당하게 대상을 공유하기 때문입니다. Document Service는 대상을 *옮겨서* 이를 강제합니다. 대상을 연결하면 같은 상태의 다른 문서가 가진 링크를 제거하며, Strapi와 같은 동작입니다.
- `document_id`는 대상 테이블에서 고유하지 않으므로 `target_document_id`에는 외래 키가 없습니다. Document Service는 존재하지 않는 문서로 가는 링크를 거부하고, 문서의 마지막 버전이 삭제되면 같은 트랜잭션에서 그 문서를 가리키는 링크를 제거합니다.
- 링크 행은 `id` 기본 키를 유지하므로, 마이그레이션 엔진과 SQLite 테이블 재구성에게 링크 테이블은 다른 테이블과 똑같아 보입니다.
- 테이블 이름을 바꾸면 링크 테이블도 함께 이름이 바뀝니다. 마이그레이션은 SQLite의 `foreign_keys`를 끈 상태로 실행하므로 테이블 재구성이 링크 테이블로 cascade되지 않습니다.

**다형성 관계**(`morphToOne`, `morphToMany`)는 어떤 콘텐츠 타입의 문서든 연결합니다. 링크는 `source_id`, `target_type`(대상의 uid), `target_document_id`, `position`을 가진 `{table}_{column}_mph`에 있으며, `(source_id, target_type, target_document_id)`가 고유하고 `morphToOne`은 `source_id`도 고유합니다. 역방향 쪽(`morphOne`, `morphMany`)에는 테이블이 없습니다. 자신을 가리키는 소유 쪽 링크를 읽으며 읽기 전용입니다. 문서를 삭제하면 그 문서로 가는 다형성 링크가 제거됩니다. 이 관계로 할 수 있는 것과 없는 것은 [관계](/ko/concepts/relations/)를 참고하세요.

## 컴포넌트와 다이나믹 존: JSON 컬럼

컴포넌트 속성이나 다이나믹 존은 문서 행의 **JSON 컬럼 하나**입니다(PostgreSQL은 `jsonb`, MySQL과 MariaDB는 `json`, SQLite는 `text`). Strapi는 각 컴포넌트를 다형성 조인 테이블과 함께 자체 테이블에 저장하지만, 컬럼 하나로 그런 조인을 피하고 게시와 기록을 단순한 복사로 만듭니다.

```json
// "seo" column (a single component)
{ "id": 1, "metaTitle": "…", "metaDescription": "…" }

// "blocks" column (a dynamic zone)
[
  { "id": 1, "__component": "blocks.hero", "title": "…" },
  { "id": 2, "__component": "blocks.quote", "text": "…", "author": "…" }
]
```

- 모든 컴포넌트 항목에는 속성 안에서 고유한 정수 `id`가 있습니다. 새 항목은 다음 빈 번호를 받습니다.
- 데이터는 쓸 때마다 컴포넌트 스키마로 검증합니다.
- 게시와 폐기는 JSON을 그대로 복사합니다.
- **컴포넌트 안의 관계와 미디어**는 JSON 자체에 저장합니다. 관계는 `documentId`(여기서는 `oneWay`와 `manyWay`만 허용), 미디어는 파일 id입니다. 쓸 때 확인하고, 컴포넌트를 populate할 때 배치 쿼리로 해석합니다. 다형성 관계와 `password` 속성은 컴포넌트 안에 둘 수 없습니다.
- **필터링**에는 방언별 JSON 함수가 필요합니다. 단일 컴포넌트의 스칼라 필드는 JSON 경로로 읽습니다(PostgreSQL은 `#>>`, MySQL과 MariaDB는 `JSON_VALUE`, SQLite는 `json_extract`). 반복 가능한 컴포넌트는 배열 항목에 대한 `EXISTS`를 씁니다(`jsonb_array_elements`, `JSON_TABLE`, `json_each`). 다이나믹 존은 항목마다 필드가 다르므로 `__component`로만 필터링할 수 있습니다.

모델링 측면은 [컴포넌트와 다이나믹 존](/ko/concepts/components-and-dynamic-zones/)을 참고하세요.

## 플랫폼 테이블

플랫폼 테이블은 모든 도출 모델의 일부이므로, 마이그레이션 엔진이 콘텐츠 테이블과 똑같이 만들고 발전시킵니다. `verdin migrate plan`에 safe 단계로 나타납니다. `crates/verdin-migrate/src/system.rs`에 정의되어 있습니다.

| 영역 | 테이블 |
|---|---|
| 마이그레이션 | `vd_schema_snapshots`, `vd_migrations_journal`(마이그레이션 엔진 소유, 처음 쓸 때 생성) |
| 관리자 | `vd_admin_users`, `vd_admin_roles`, `vd_admin_user_roles`, `vd_admin_permissions`, `vd_sessions`(리프레시 토큰), `vd_admin_tokens`(초대와 재설정 링크), `vd_admin_two_factor`, `vd_admin_passkeys`, `vd_spent_challenges` |
| 콘텐츠 API 접근 | `vd_api_tokens`, `vd_api_token_permissions`, `vd_public_permissions` |
| 최종 사용자 | `vd_users`, `vd_user_roles`, `vd_user_role_permissions`, `vd_end_user_sessions` |
| 인스턴스 | `vd_settings`(기능 스위치, 편집 보기 레이아웃, 일회성 업그레이드 표시), `vd_locales`, `vd_cluster_events`(공유 이벤트 버스, [여러 인스턴스](/ko/deploy/scaling/) 참고) |
| 미디어 | `vd_files`, `vd_folders` |
| 콘텐츠 워크플로 | `vd_history_versions`, `vd_releases`, `vd_release_actions`, `vd_workflows`, `vd_workflow_stages`, `vd_document_stages` |
| 협업 | `vd_comments`, `vd_tasks`, `vd_document_views`, `vd_document_votes`, `vd_polls`, `vd_poll_votes` |
| 연동 | `vd_webhooks`, `vd_webhook_deliveries`, `vd_deploy_targets`, `vd_deployments`, `vd_plugin_kv`, `vd_audit_logs` |
| 사이트 기능 | `vd_redirects`, `vd_menus`, `vd_forms`, `vd_form_submissions` |

## 미디어 테이블

파일은 Strapi 형식(`name`, `alternative_text`, `caption`, `width`, `height`, `formats`, `hash`, `ext`, `mime`, `size`, `url`, `provider`…)의 `vd_files` 행이며, `focal_point`, `folder_id`, `folder_path`가 추가됩니다. 폴더(`vd_folders`)는 `/1/4`처럼 `path_id`로 된 Strapi의 `path`를 유지합니다.

미디어 속성은 `source_id`(콘텐츠 행), `file_id`(`vd_files` 행), `position`을 가진 링크 테이블 `{table}_{column}_mda`입니다. `(source_id, file_id)`가 고유하고, 속성이 `multiple`이 아니면 `source_id`도 고유합니다. 두 컬럼 모두 `ON DELETE CASCADE`인 외래 키이므로, 파일이나 행을 삭제하면 그 링크가 제거됩니다. 미디어 링크는 관계 링크와 같은 초안·게시 규칙을 따릅니다. 각 버전이 자기 링크를 가지며 게시하면 복사됩니다.

업로드, 포맷, 스토리지 프로바이더의 동작은 [미디어](/ko/concepts/media/)에 있습니다.
