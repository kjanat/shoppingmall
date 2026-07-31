# syntax=docker/dockerfile:1
# ── build: tsc + vite build ──────────────────────────────────────────────
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY server ./server
COPY src ./src
RUN bun run build
# Production server (static dist/ + /api middleware) as one self-contained
# bundle — no vite, no node_modules in the runtime image
RUN bun build server/main.ts --target=bun --outfile=server.js

# ── runtime: bun server.js ───────────────────────────────────────────────
# /api/dj/request shells out to yt-dlp, which needs python3 + ffmpeg.
FROM oven/bun:1.3 AS runtime
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ffmpeg ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
ARG TARGETARCH
ARG _YTARCH=${TARGETARCH/amd64/}
ARG YTDLP_SUFFIX=${_YTARCH/arm64/_aarch64}
ADD --chmod=755 https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_linux${YTDLP_SUFFIX} /usr/local/bin/yt-dlp
# bun as EJS runtime is opt-in; system config so every invocation gets it
RUN echo "--js-runtimes bun" > /etc/yt-dlp.conf

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --from=build --chown=bun:bun /app/server.js ./server.js
# Crate dir is a bind mount at runtime; pre-create so it mounts writable-owned
RUN mkdir -p public/dj-music && chown -R bun:bun public

USER bun
EXPOSE 5174
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["bun", "-e", "fetch('http://localhost:5174/api/dj/status').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "server.js"]
