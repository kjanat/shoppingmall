# syntax=docker/dockerfile:1
# ── build: tsc + one bun build (server + client, compiled to one binary) ─
# Alpine here too: the binary embeds the bun runtime of this stage, so it
# has to be linked against the same libc as the runtime image.
FROM oven/bun:1.3-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY build.ts index.html tsconfig.json ./
COPY server ./server
COPY src ./src
# The bundler reaches into public/: the favicon is hashed into index.html and
# the voice manifests are JSON imports. Whole dir, so a new import can't fail
# the build on a copy line nobody remembered to extend. dj-music is .dockerignored.
COPY public ./public
RUN bun run build

# ── runtime: ./mall ──────────────────────────────────────────────────────
# Bare alpine: the binary carries its own bun, so the image needs no runtime
# beyond libstdc++. Debian's ffmpeg drags in mesa/X11/SDL/pango (~480 MB) for
# a headless audio transcoder; alpine's is a fraction of that.
FROM alpine:3 AS runtime
RUN apk add --no-cache ffmpeg ca-certificates libstdc++ libgcc \
  && addgroup -S mall && adduser -S -G mall mall
ARG TARGETARCH
ARG _YTARCH=${TARGETARCH/amd64/}
ARG YTDLP_SUFFIX=${_YTARCH/arm64/_aarch64}
ADD --chmod=755 https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_musllinux${YTDLP_SUFFIX} /usr/local/bin/yt-dlp
# bun as EJS runtime is opt-in; system config so every invocation gets it
RUN echo "--js-runtimes bun" > /etc/yt-dlp.conf
# ...and BUN_BE_BUN makes the app binary answer as the bun CLI, so yt-dlp gets
# its runtime without a second bun in the image. Per invocation, not an ENV:
# with it set globally, ./mall would drop its own entrypoint too.
RUN printf '#!/bin/sh\nexec env BUN_BE_BUN=1 /app/mall "$@"\n' > /usr/local/bin/bun \
  && chmod 755 /usr/local/bin/bun

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=mall:mall /app/dist/mall ./mall
# Serve fingerprinted browser assets separately so they receive immutable
# caching headers; the executable still contains the dev HTML manifest.
COPY --from=build --chown=mall:mall /app/dist/static ./dist/static
COPY --chown=mall:mall public ./public
# dj-music is a bind mount at runtime
RUN mkdir -p public/dj-music && chown -R mall:mall public

USER mall
EXPOSE 5174
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bun", "-e", "fetch('http://localhost:5174/api/dj/status').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["./mall"]
