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
RUN cargo build --release -p wedsync-server -p wedsync-agent
# collect the onnxruntime shared lib(s) for the runtime image
RUN mkdir -p /app/libs && find target/release/build -name "libonnxruntime*" -exec cp -L {} /app/libs/ \;

# ---------- runtime ----------
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/target/release/wedsync-server /app/target/release/wedsync /usr/local/bin/
COPY --from=build /app/libs/ /usr/local/lib/
COPY --from=web /app/web/dist /app/web/dist

ENV LD_LIBRARY_PATH=/usr/local/lib \
    WEB_DIST=/app/web/dist \
    WEDSYNC_DATA=/app/data

EXPOSE 8080 9000
VOLUME /app/data
CMD ["wedsync-server", "serve", "--port", "8080"]
