# syntax=docker/dockerfile:1

# ---------- frontend ----------
FROM node:20-bookworm-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- rust (server + agent) ----------
FROM rust:1-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
# workspace member manifests must be readable even though the desktop app
# itself is never built in here
COPY desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.toml
COPY desktop/src-tauri/src desktop/src-tauri/src
# web/dist must exist at compile time: rust-embed bakes the SPA into the
# binary (the hub serves /perf + /assets/* from it for cookie-less visitors)
COPY --from=web /app/web/dist ./web/dist
RUN cargo build --release -p wedsync-server -p wedsync-agent
# collect the onnxruntime shared lib(s) for the runtime image
RUN mkdir -p /app/libs && find target/release/build -name "libonnxruntime*" -exec cp -L {} /app/libs/ \;

# ---------- hub binary for bare-metal hub deploys ----------
# The hub server runs Ubuntu 20.04 (glibc 2.31) — bookworm binaries need
# glibc 2.32+, so this stage must stay on old-glibc bases.
FROM rust:1-bullseye AS hub
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
COPY desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.toml
COPY desktop/src-tauri/src desktop/src-tauri/src
COPY --from=web /app/web/dist ./web/dist
# no face feature → no onnxruntime shared-lib dependency; SPA still embedded
RUN cargo build --release -p wedsync-server --no-default-features --target-dir /app/target-hub \
    && cp /app/target-hub/release/wedsync-server /app/wedsync-server-hub

# ---------- runtime ----------
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/target/release/wedsync-server /app/target/release/wedsync /usr/local/bin/
COPY --from=hub /app/wedsync-server-hub /usr/local/bin/wedsync-server-hub
COPY --from=build /app/libs/ /usr/local/lib/
COPY --from=web /app/web/dist /app/web/dist

ENV LD_LIBRARY_PATH=/usr/local/lib \
    WEB_DIST=/app/web/dist \
    WEDSYNC_DATA=/app/data

EXPOSE 8080 9000
VOLUME /app/data
CMD ["wedsync-server", "serve", "--port", "8080"]
