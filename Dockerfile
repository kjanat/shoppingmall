# syntax=docker/dockerfile:1
# ── build: tsc + one bun build (server + client, compiled to one binary) ─
FROM oven/bun:1.3-alpine AS build
WORKDIR /app
COPY --from=kjanat/runner:latest /run /runner /usr/local/bin/
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY build.ts globals.d.ts index.html tsconfig.json ./
COPY public ./public
COPY scripts ./scripts
COPY server ./server
COPY src ./src
ARG GIT_DESCRIBE
ENV GIT_DESCRIBE=$GIT_DESCRIBE
RUN bun run build

# ── runtime: ./mall ──────────────────────────────────────────────────────
FROM alpine:3 AS runtime
RUN apk add --no-cache ffmpeg ca-certificates libstdc++ libgcc \
  && addgroup -S mall && adduser -S -G mall mall
ARG TARGETARCH
ARG _YTARCH=${TARGETARCH/amd64/}
ARG YTDLP_SUFFIX=${_YTARCH/arm64/_aarch64}
ADD --chmod=755 https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_musllinux${YTDLP_SUFFIX} /usr/local/bin/yt-dlp
RUN printf "--js-runtimes bun\n" > /etc/yt-dlp.conf \
  && printf '#!/bin/sh\nexec env BUN_BE_BUN=1 /app/mall "$@"\n' > /usr/local/bin/bun \
  && chmod 755 /usr/local/bin/bun

ENV NODE_ENV=production
WORKDIR /app
COPY --chown=mall:mall public ./public
RUN mkdir -p public/dj-music && chown -R mall:mall public
COPY --from=build --chown=mall:mall /app/dist/mall ./mall
COPY --from=build --chown=mall:mall /app/dist/static ./dist/static

USER mall
EXPOSE 5174
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bun", "-e", "fetch('http://localhost:5174/api/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["./mall"]
