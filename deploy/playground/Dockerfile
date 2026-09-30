# syntax=docker/dockerfile:1
# Hosted playground: the blog example on SQLite with demo content, wiped and seeded again
# every hour (run.sh). Build from the repository root:
#   docker build -f deploy/playground/Dockerfile -t verdin-playground .
#   docker run -p 1337:1337 --tmpfs /var/lib/verdin-playground:uid=65532,gid=65532 verdin-playground
# Demo account: demo@example.com / verdin-demo-1234 (PLAYGROUND_EMAIL, PLAYGROUND_PASSWORD).
ARG VERDIN_IMAGE=ghcr.io/verdin-cms/verdin:0.11
FROM ${VERDIN_IMAGE} AS verdin

FROM alpine:3.22
RUN apk add --no-cache curl jq tini \
    && addgroup -S -g 65532 verdin && adduser -S -D -H -u 65532 -G verdin verdin \
    && mkdir -p /var/lib/verdin-playground && chown verdin:verdin /var/lib/verdin-playground
# The release image's binary is static (musl), so it runs on Alpine.
COPY --from=verdin /usr/local/bin/verdin /usr/local/bin/verdin
COPY examples/blog/schema /app/schema
COPY deploy/playground/verdin.toml deploy/playground/run.sh deploy/playground/seed.sh /app/
ENV VERDIN_CONFIG=/app/verdin.toml
USER verdin
EXPOSE 1337
HEALTHCHECK --interval=30s --timeout=6s --start-period=30s CMD ["verdin", "healthcheck"]
ENTRYPOINT ["/sbin/tini", "--", "/app/run.sh"]
