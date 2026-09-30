---
title: Linux 서버
description: .deb 패키지로 Debian이나 Ubuntu 서버에서 Verdin을 실행합니다 — systemd 서비스, verdin 시스템 사용자, /var/lib/verdin의 상태 — 리버스 프록시 뒤에서.
sidebar:
  order: 3
---

이 페이지에서는 모든 릴리스에 첨부된 `.deb` 패키지로, 컨테이너 없이 Debian이나 Ubuntu 서버에서 Verdin을 직접
실행합니다. [설치 스크립트](/ko/start/installation/)의 바이너리와
[`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb)의 파일을 직접 복사하면 다른
배포판에서도 같은 구성이 동작합니다.

패키지는 2026-09-30에 `cargo deb`로 빌드하고 검사했으며, 이 가이드를 위해 실제 서버에 설치하지는
않았습니다.

## 패키지가 설치하는 것

| 경로 | 설명 |
| --- | --- |
| `/usr/bin/verdin` | 바이너리(정적, 관리자 패널 내장). |
| `/etc/verdin/verdin.toml` | 설정(conffile: 업그레이드해도 편집 내용이 유지됨). |
| `/etc/verdin/verdin.env` | 처음 설치할 때 모드 `0640`으로 생성: 새 `VERDIN_ADMIN_JWT_SECRET`과 `VERDIN_TOKEN_PEPPER`, 그리고 `VERDIN_DATABASE_URL`(기본값은 SQLite). |
| `/var/lib/verdin/` | `verdin` 시스템 사용자의 홈: SQLite 데이터베이스, `schema/`, `uploads/`, 검색 인덱스, 이미지 캐시. |
| `/usr/lib/systemd/system/verdin.service` | 서비스. 설치되지만 활성화되지는 않습니다. |

서비스는 `verdin -c /etc/verdin/verdin.toml start --migrate`를 `verdin` 사용자로 실행하며, systemd의
샌드박싱(읽기 전용 시스템, 비공개 `/tmp`, 새 권한 금지)을 적용하고 `/var/lib/verdin`에만 쓰기 권한을 줍니다.
`127.0.0.1:1337`에서 수신합니다.

## 1. 설치

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

ARM 서버에서는 파일 이름에 `arm64`를 쓰세요.

## 2. 설정

1. 커밋한 스키마를 `verdin`이 소유하도록 `/var/lib/verdin/schema/`(`content-types/`와 `components/`)에
   복사합니다.

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. PostgreSQL, MySQL, MariaDB라면 `/etc/verdin/verdin.env`의 `VERDIN_DATABASE_URL`을 편집하세요. 두 시크릿은
   유지하세요. `VERDIN_TOKEN_PEPPER`가 새로 바뀌면 모든 API 토큰이 무효화됩니다.
3. `/etc/verdin/verdin.toml`에서 `[server].public_url`을 브라우저가 쓰는 주소로 설정하고, 리버스 프록시가 같은
   머신에서 실행된다면 `trusted_proxies = ["127.0.0.1"]`로 설정하세요. 다른 모든 키는
   [설정 레퍼런스](/ko/reference/configuration/)에 있습니다.

## 3. 시작

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

처음 시작하면 테이블이 만들어집니다. 명령줄에서 첫 관리자를 만드세요(서비스의 환경 파일에 데이터베이스
URL이 있습니다).

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

또는 프록시를 통해 관리자 패널을 열고 거기서 등록하세요.

## 4. 앞에 리버스 프록시 두기

Verdin은 루프백 인터페이스에서 일반 HTTP를 제공합니다. 인증서를 스스로 받고 갱신하는 Caddy라면:

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

nginx도 동작합니다. 실시간 이벤트가 지연되지 않도록 `/api/_events`의 버퍼링을 끄세요(`proxy_buffering off;`).

## 업그레이드와 제거

- **업그레이드:** 다음 릴리스의 `.deb`를 `apt install ./verdin_….deb`로 설치하세요. 서비스가 실행 중이었다면
  다시 시작되고, `start --migrate`가 safe 마이그레이션을 적용합니다. 먼저
  [업그레이드](/ko/migrate/upgrading/)를 읽으세요.
- **제거:** `apt remove verdin`은 서비스를 멈추고 데이터와 설정을 남깁니다. `apt purge verdin`은
  `/etc/verdin/verdin.env`(시크릿)도 삭제합니다. `verdin` 사용자와 `/var/lib/verdin`은 패키지가 절대 삭제하지
  않습니다. [백업](/ko/deploy/backups/)을 만든 뒤 직접 제거하세요.
