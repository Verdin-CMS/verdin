---
title: 호스팅 플레이그라운드
description: Verdin의 공개 데모를 실행합니다 — 데모 콘텐츠와 데모 계정이 있는 SQLite 기반 블로그 예제를 매시간 지우고 다시 시딩합니다 — deploy/playground에서.
sidebar:
  order: 11
---

[`deploy/playground/`](https://github.com/verdin-cms/verdin/tree/main/deploy/playground)는 공개 데모용 컨테이너를
빌드합니다. SQLite 기반 [블로그 예제](https://github.com/verdin-cms/verdin/tree/main/examples/blog)에 게시된
글 몇 개와 방문자가 로그인할 수 있는 데모 계정이 들어 있습니다. 매시간 데이터베이스를 버리고 처음부터 다시
시작합니다. 컨테이너에는 볼륨도, 데이터베이스 서버도, 직접 준비할 시크릿도 필요 없습니다. 어디에 호스팅할지는
자유입니다. 공개 HTTPS 주소로 컨테이너 하나를 실행하는 플랫폼이면 어디든 됩니다.

스크립트는 2026-09-30에 로컬 빌드로 실행했으며(리셋 주기 세 번), 이미지는 빌드했지만 게시된 릴리스로는
실행하지 않았습니다.

## 방문자가 얻는 것

- `/admin/`의 관리자 패널. **demo@example.com** / **verdin-demo-1234**로 로그인된 상태입니다. 이 계정은
  **Editor** 역할이라 콘텐츠를 만들고, 편집하고, 게시하고, 삭제하고 미디어를 업로드할 수 있지만 사용자, 역할,
  API 토큰, 웹훅, 설정은 관리할 수 없습니다.
- REST(`/api/articles?populate=*`)와 GraphQL로 글, 카테고리, 태그, 홈페이지를 공개 읽기.
- 게시된 글 두 개, 초안 하나, 카테고리 두 개, 태그 두 개, 홈페이지.

Super Admin도 있지만 아무도 모르는 무작위 비밀번호를 가집니다.

## 동작 방식

`run.sh`가 반복합니다.

1. `/var/lib/verdin-playground`(데이터베이스, 업로드, 검색 인덱스, 이미지 캐시)를 삭제하고 새 시크릿을 생성하므로
   지난 주기의 세션은 끝납니다.
2. `verdin start --migrate`를 시작하고 `/_ready`를 기다립니다.
3. `seed.sh`를 실행합니다. CLI와 admin API로 계정을 만들고, 공개 읽기를 열고, 콘텐츠를 만듭니다.
4. `PLAYGROUND_RESET_SECONDS`(3600)를 기다린 뒤 서버를 멈추고 처음부터 다시 시작합니다. 서버가 스스로 멈추면
   즉시 다시 시작합니다.

설정(`deploy/playground/verdin.toml`)은 업로드를 2 MB로 제한하고, 익명 요청을 주소당 분당 300회로 제한하며,
웹훅 전송이 사설 주소로 가지 않게 하고, 검색을 켭니다.

## 빌드하고 실행하기

저장소 루트에서:

```sh frame="terminal"
docker build -f deploy/playground/Dockerfile -t verdin-playground .
docker run -p 1337:1337 --tmpfs /var/lib/verdin-playground:uid=65532,gid=65532 verdin-playground
```

이미지는 `curl`과 `jq`가 있는 Alpine(스크립트에 셸이 필요한데 공식 이미지에는 없습니다)에
`ghcr.io/verdin-cms/verdin`에서 복사한 정적 바이너리를 더한 것입니다. 릴리스를 고르려면
`--build-arg VERDIN_IMAGE=ghcr.io/verdin-cms/verdin:<version>`을 넘기세요. `tmpfs`는 데이터를 메모리에
두며, 없어도 데이터가 컨테이너의 파일 시스템에 남아 동작합니다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PLAYGROUND_RESET_SECONDS` | `3600` | 리셋 사이의 시간. |
| `PLAYGROUND_EMAIL`, `PLAYGROUND_PASSWORD` | `demo@example.com`, `verdin-demo-1234` | 데모 계정. |
| `VERDIN_SERVER__PUBLIC_URL` | | 플레이그라운드의 공개 주소. |
| `VERDIN_SERVER__TRUSTED_PROXIES` | | 플랫폼 프록시의 범위. 요청 한도가 방문자별로 적용되도록 합니다. |

## 호스팅하기

인스턴스를 정확히 하나만 실행하고(데이터베이스가 로컬입니다), 계속 켜 두고(0으로 스케일 다운 금지: 리셋 타이머가
프로세스 안에 있습니다), 앞에 HTTPS를 두세요. 관리자 패널의 세션 쿠키는 `start` 모드에서 `Secure`이므로
로그인에 HTTPS가 필요합니다. 누구나 최대 한 시간 동안 콘텐츠를 쓰고 이미지를 업로드할 수 있으므로, 이 링크를
거는 페이지에 리셋 일정을 안내하고 쿠키를 공유하는 다른 것과는 별도의 도메인에 인스턴스를 두세요.
