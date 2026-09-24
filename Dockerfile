# syntax=docker/dockerfile:1
# Verdin: a single binary with the admin panel embedded.
#   docker build -t verdin .

FROM node:24-alpine AS admin
WORKDIR /src/admin
COPY admin/package.json admin/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY admin/ ./
RUN npm run build

FROM rust:1-bookworm AS server
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
COPY --from=admin /src/admin/dist/admin/browser admin/dist/admin/browser
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p verdin --features embed-admin \
    && cp target/release/verdin /usr/local/bin/verdin \
    && mkdir -p /out/data/schema/content-types /out/data/schema/components

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=server /usr/local/bin/verdin /usr/local/bin/verdin
COPY docker/image/verdin.toml /app/verdin.toml
# The volume holds the SQLite database and, in `dev`, the schema the builder edits.
COPY --from=server --chown=65532:65532 /out/data /data
ENV VERDIN_CONFIG=/app/verdin.toml \
    VERDIN_DATABASE_URL=sqlite:///data/verdin.db
VOLUME /data
EXPOSE 1337
ENTRYPOINT ["/usr/local/bin/verdin"]
CMD ["start", "--migrate"]
