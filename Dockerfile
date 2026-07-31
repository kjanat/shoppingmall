# syntax=docker/dockerfile:1
# ── build: tsc + one bun build (server + client bundle) ──────────────────
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY build.ts index.html tsconfig.json ./
COPY server ./server
COPY src ./src
# The favicon is bundled (hashed) from index.html; the rest of public/ is
# served as-is at runtime
COPY public/favicon.svg ./public/favicon.svg
RUN bun run build

# ── runtime: bun main.js ─────────────────────────────────────────────────
# Alpine: Debian's ffmpeg drags in mesa/X11/SDL/pango (~480 MB) for a
# headless audio transcoder; alpine's is a fraction of that.
FROM oven/bun:1.3-alpine AS runtime
RUN apk add --no-cache ffmpeg ca-certificates
ARG TARGETARCH
ARG _YTARCH=${TARGETARCH/amd64/}
ARG YTDLP_SUFFIX=${_YTARCH/arm64/_aarch64}
ADD --chmod=755 https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_musllinux${YTDLP_SUFFIX} /usr/local/bin/yt-dlp
# bun as EJS runtime is opt-in; system config so every invocation gets it
RUN echo "--js-runtimes bun" > /etc/yt-dlp.conf

ENV NODE_ENV=production
WORKDIR /app
# dist/ keeps its shape: server/main.js with public/ one level up, exactly as
# in the repo, so the server resolves assets off import.meta.dir either way.
COPY --from=build --chown=bun:bun /app/dist/ ./
# Crate dir is a bind mount at runtime; pre-create so it mounts writable-owned
RUN mkdir -p public/dj-music && chown -R bun:bun public

USER bun
EXPOSE 5174
# Bun looks up the client manifest relative to cwd, so run from the bundle dir
WORKDIR /app/server
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bun", "-e", "fetch('http://localhost:5174/api/dj/status').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "main.js"]
