# syntax=docker/dockerfile:1
# The image the one-click deploys build (render.yaml, .do/deploy.template.yaml,
# railway.json, fly.toml, compose.coolify.yaml): the official image with the blog
# example's schema. In your fork, replace examples/blog/schema with your own (or change
# the COPY line) — production servers do not edit the schema.
# Build context: the repository root.
ARG VERDIN_VERSION=0.11
FROM ghcr.io/verdin-cms/verdin:${VERDIN_VERSION}
COPY deploy/one-click/verdin.toml /app/verdin.toml
COPY examples/blog/schema /app/schema
# Render, Railway and Fly mount volumes owned by root; the official image runs as uid
# 65532 and could not write to /data. Remove this line if your platform's volume is
# writable by that user (or you keep no state on the instance).
USER root
