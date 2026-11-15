# The renderer of the exports in the cloud (server.ts): the command line's render with Chrome and ffmpeg, as a
# container behind the Worker (apps/worker/src/container.ts, RendererContainer).
# Build from the repository's root: docker build -f apps/renderer/Dockerfile -t tramme-renderer .
# The workspace is installed for the command line (packages/cli and what it uses), with pnpm.

FROM node:24-slim
# Chrome's dependencies come with Debian's Chromium; ffmpeg comes with ffmpeg-static (packages/cli)
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto fonts-noto-color-emoji ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV CHROME_PATH=/usr/bin/chromium
RUN npm install -g pnpm@12.18.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@tramme/cli..." --filter "@tramme/renderer"
ENV PORT=8080
EXPOSE 8080
CMD ["node", "apps/renderer/server.ts"]
