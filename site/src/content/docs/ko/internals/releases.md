---
title: 릴리스와 문서 호스팅
description: 릴리스 워크플로가 게시하는 것(바이너리, 체크섬, .deb 패키지, 이미지, Homebrew, winget), 각 선택 작업에 필요한 시크릿, 그리고 문서 사이트와 그 도메인, 풀 리퀘스트 미리 보기가 호스팅되는 방식.
sidebar:
  order: 9
---

이 페이지는 메인테이너를 위한 것입니다. 버전 태그를 푸시하면 무슨 일이 일어나는지, 어떤 부분에 시크릿이나 계정이
필요한지, 문서 사이트가 어떻게 게시되는지를 다룹니다.

## 릴리스 워크플로

태그 `vX.Y.Z`를 푸시하면 `.github/workflows/release.yml`이 실행됩니다.

| 작업 | 게시하는 것 | 필요한 것 |
| --- | --- | --- |
| `admin`, `binaries` | `x86_64`/`aarch64-unknown-linux-musl`, `x86_64`/`aarch64-apple-darwin`, `x86_64-pc-windows-msvc`용 `verdin-vX.Y.Z-<target>.tar.gz`(Windows는 `.zip`). 각 아카이브에는 `verdin`과 라이선스가 든 폴더가 하나 있습니다. | 없음 |
| `deb` | musl 바이너리로 `cargo deb --no-build`를 실행해 만든 `verdin_X.Y.Z-1_amd64.deb`와 `_arm64.deb`. | 없음 |
| `publish` | GitHub 릴리스: 아카이브, 패키지, `SHA256SUMS`, 그리고 해당 버전의 `CHANGELOG.md` 섹션의 노트. | 없음 |
| `image` | amd64와 arm64용 `ghcr.io/verdin-cms/verdin`. | 없음 |
| `npm` | `@verdin/client`. | `NPM_TOKEN`(없으면 건너뜀) |
| `homebrew` | `deploy/homebrew/verdin.rb.in`에서 만든 탭의 `Formula/verdin.rb`. | `HOMEBREW_TAP_TOKEN`(없으면 건너뜀) |
| `winget` | `deploy/winget/`의 매니페스트로 `microsoft/winget-pkgs`에 보내는 풀 리퀘스트. | `WINGET_TOKEN`(없으면 건너뜀) |

에셋 이름은 계약입니다. `install.sh`, `crates/verdin/Cargo.toml`의 `cargo binstall` 메타데이터, Homebrew
포뮬러, winget 매니페스트가 모두 버전과 타깃으로 이름을 만듭니다. `deploy/render-template.sh`는 Homebrew와
winget 템플릿을 버전과 `SHA256SUMS`의 체크섬으로 채우며, 하나라도 없으면 실패합니다.

## 선택 작업의 일회성 설정

| 대상 | 위치 |
| --- | --- |
| **Homebrew 탭.** 공개 저장소 `verdin-cms/homebrew-tap`을 만드세요(이 이름 덕분에 `brew install verdin-cms/tap/verdin`이 동작합니다). 그 저장소에 *Contents: read and write* 권한을 가진 세분화된 토큰을 `HOMEBREW_TAP_TOKEN` 시크릿으로 추가하세요. 다른 저장소라면 `HOMEBREW_TAP_REPOSITORY` 변수를 설정하세요. | 저장소 시크릿과 변수 |
| **winget.** `VerdinCMS.Verdin`의 첫 제출은 winget 메인테이너가 검토합니다. 제출하는 계정으로 `microsoft/winget-pkgs`를 포크하고, 그 계정의 `public_repo` 스코프를 가진 클래식 토큰을 `WINGET_TOKEN`으로 추가하세요. | 저장소 시크릿 |
| **npm.** `NPM_TOKEN`, `@verdin` 스코프의 자동화 토큰. | 저장소 시크릿 |
| **crates.io**(선택). `--git` 없는 `cargo binstall verdin`은 crates.io에 크레이트가 있어야 합니다. 그 전까지 문서는 `--git`을 씁니다. | — |
| **Railway 버튼**(선택). railway.com에서 저장소로 템플릿을 만들고(설정 경로 `deploy/one-click/railway.json`, PostgreSQL 서비스, `/data`의 볼륨) README와 [원클릭 배포](/ko/deploy/one-click/)에 그 버튼을 추가하세요. | railway.com |

Render와 DigitalOcean 버튼은 프로젝트 쪽에 계정이 필요 없습니다. 기본 브랜치의 `render.yaml`과
`.do/deploy.template.yaml`을 읽습니다.

일부 버전은 파일에 적혀 있으며 마이너 릴리스마다 함께 움직입니다. `deploy/one-click/Dockerfile`,
`deploy/playground/Dockerfile`, `deploy/compose/`, 문서의 이미지 태그, 그리고
`deploy/helm/verdin/Chart.yaml`의 `version`/`appVersion`입니다.

## 문서 사이트

`.github/workflows/site.yml`은 `site/`를 건드리는 `main`에 대한 모든 푸시에서 `site/`를 빌드하고 결과를
`gh-pages` 브랜치의 루트에 푸시합니다. GitHub Pages가 그 브랜치를 제공합니다(Settings → Pages → Source:
*Deploy from a branch*, `gh-pages`, `/`).

### 도메인

사이트가 어디에 있는지는 저장소 변수 하나, **`SITE_URL`**로 정합니다.

| `SITE_URL` | 사이트 |
| --- | --- |
| 설정 안 됨 | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | 그 도메인의 루트 |
| `https://example.com/verdin` | 그 도메인의 `/verdin` 아래 |

`site/scripts/repo.mjs`가 여기서 Astro의 `site`와 `base`를 가져오므로 모든 링크, 에셋, 사이트맵이 따라갑니다.
`BASE_PATH`가 설정되어 있으면 여전히 경로를 재정의합니다. 사용자 정의 도메인이라면:

1. 도메인의 DNS를 GitHub Pages로 향하게 합니다(서브도메인이라면 `verdin-cms.github.io`로 `CNAME` 레코드).
2. Settings → Secrets and variables → Actions → Variables에서 `SITE_URL`을 설정합니다.
3. Site 워크플로를 실행합니다(또는 `main`에 푸시). 브랜치에 `CNAME` 파일을 쓰고 GitHub가 도메인을 인식합니다.
   인증서가 발급되면 *Enforce HTTPS*를 켜세요.

사이트 밖의 링크(README, 패키지 메타데이터, Helm 차트의 `home`)는 `verdin-cms.github.io/verdin` 주소를
유지하며, GitHub가 이를 사용자 정의 도메인으로 리디렉션합니다.

### 풀 리퀘스트 미리 보기

사이트를 건드리는 각 풀 리퀘스트는 `<SITE_URL>/pr-preview/pr-<number>/`에 미리 보기를 받고, 댓글로 링크됩니다.

1. `site-preview.yml`은 `pull_request`에서 실행됩니다. `SITE_URL`을 미리 보기 주소로 설정해 사이트를 빌드하고
   아티팩트로 업로드합니다. 풀 리퀘스트의 코드를 실행하므로, 포크의 모든 `pull_request` 워크플로처럼 읽기
   전용 토큰을 가지며 시크릿은 없습니다.
2. `site-preview-deploy.yml`은 그 빌드가 성공하면 `workflow_run`에서 이 저장소의 컨텍스트로 실행됩니다.
   아티팩트를 내려받고, 풀 리퀘스트가 열려 있는지와 빌드가 현재 head에 대한 것인지 확인한 뒤, 파일을
   `gh-pages`의 `pr-preview/pr-<number>/`에 복사하고 댓글을 갱신합니다. 풀 리퀘스트 코드를 체크아웃하거나
   실행하지 않습니다.
3. 풀 리퀘스트가 닫히면 같은 워크플로(`gh-pages`만 클론하는 `pull_request_target`)가 폴더를 삭제합니다.

메인 배포는 `pr-preview/`를 유지하며, 셋 모두 하나의 동시성 그룹을 공유하므로 한 번에 작업 하나만
`gh-pages`에 씁니다.

미리 보기는 문서와 같은 오리진에서 제공됩니다. 로그인이 없는 정적 사이트에서는 받아들일 만하지만, 포크의 풀
리퀘스트는 닫힐 때까지 그곳에 어떤 HTML이든 게시할 수 있으므로 악용하는 풀 리퀘스트는 닫으세요. 저장소 변수를
포크의 워크플로에서 쓸 수 없으면 그 미리 보기는 기본 `SITE_URL`로 빌드되어 사용자 정의 도메인에서는 링크가
깨집니다. 이 저장소의 브랜치에서 온 풀 리퀘스트의 미리 보기는 영향을 받지 않습니다.

### 호스팅 플레이그라운드

공개 데모는 `deploy/playground/`의 컨테이너를 실행합니다. [호스팅 플레이그라운드](/ko/deploy/playground/)를
참고하세요. 호스팅은 저장소 밖의 일입니다. HTTPS 뒤에서 컨테이너 하나를 계속 실행하는 플랫폼이면 어디든
됩니다.
