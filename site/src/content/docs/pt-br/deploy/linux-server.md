---
title: Servidor Linux
description: Rode o Verdin em um servidor Debian ou Ubuntu a partir do pacote .deb — um serviço systemd, um usuário de sistema verdin, o estado em /var/lib/verdin — atrás de um proxy reverso.
sidebar:
  order: 3
---

Esta página roda o Verdin diretamente em um servidor Debian ou Ubuntu, sem contêineres, a partir
do pacote `.deb` anexado a cada release. O mesmo layout funciona em outras distribuições com o
binário do [script de instalação](/pt-br/start/installation/) e os arquivos em
[`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb) copiados à mão.

O pacote foi construído e inspecionado com `cargo deb` em 2026-09-30; ele não foi instalado em um
servidor real para este guia.

## O que o pacote instala

| Caminho | O quê |
| --- | --- |
| `/usr/bin/verdin` | O binário (estático, com o painel de administração embutido). |
| `/etc/verdin/verdin.toml` | A configuração (um conffile: as atualizações mantêm as suas edições). |
| `/etc/verdin/verdin.env` | Criado na primeira instalação, modo `0640`: `VERDIN_ADMIN_JWT_SECRET` e `VERDIN_TOKEN_PEPPER` novos, e `VERDIN_DATABASE_URL` (SQLite por padrão). |
| `/var/lib/verdin/` | O diretório home do usuário de sistema `verdin`: o banco de dados SQLite, `schema/`, `uploads/`, o índice de busca e o cache de imagens. |
| `/usr/lib/systemd/system/verdin.service` | O serviço, instalado mas não ativado. |

O serviço roda `verdin -c /etc/verdin/verdin.toml start --migrate` como o usuário `verdin`, com o
sandboxing do systemd (sistema somente leitura, `/tmp` privado, sem novos privilégios) e acesso de
escrita apenas a `/var/lib/verdin`. Ele escuta em `127.0.0.1:1337`.

## 1. Instale

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

Use `arm64` no nome do arquivo em servidores ARM.

## 2. Configure

1. Copie o seu schema commitado para `/var/lib/verdin/schema/` (`content-types/` e
   `components/`), com `verdin` como dono:

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. Para PostgreSQL, MySQL ou MariaDB, edite `VERDIN_DATABASE_URL` em
   `/etc/verdin/verdin.env`. Mantenha os dois segredos: um novo `VERDIN_TOKEN_PEPPER`
   invalida todos os tokens de API.
3. Em `/etc/verdin/verdin.toml`, defina `[server].public_url` com o endereço que os navegadores
   usam, e `trusted_proxies = ["127.0.0.1"]` quando o proxy reverso roda na mesma máquina.
   Todas as outras chaves estão na [referência de configuração](/pt-br/reference/configuration/).

## 3. Inicie

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

A primeira inicialização cria as tabelas. Crie o primeiro administrador pela linha de comando (o
arquivo de ambiente do serviço guarda a URL do banco de dados):

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

ou abra o painel de administração pelo seu proxy e registre-se lá.

## 4. Coloque um proxy reverso na frente

O Verdin serve HTTP simples na interface de loopback. Com o Caddy, que obtém e renova o
certificado sozinho:

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

O nginx também funciona; desative o buffering para `/api/_events`, para que os eventos de tempo
real não sejam retidos (`proxy_buffering off;`).

## Atualizações e remoção

- **Atualizar:** instale o `.deb` da próxima release com `apt install ./verdin_….deb`. O serviço
  reinicia se estava rodando, e `start --migrate` aplica as migrações seguras.
  Leia antes [Atualização do Verdin](/pt-br/migrate/upgrading/).
- **Remover:** `apt remove verdin` para o serviço e mantém os dados e a configuração;
  `apt purge verdin` também apaga `/etc/verdin/verdin.env` (os segredos). O usuário `verdin` e
  `/var/lib/verdin` nunca são apagados pelo pacote: remova-os você mesmo depois de ter um
  [backup](/pt-br/deploy/backups/).
