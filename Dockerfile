# Decypher — single-origin container.
# Builds the Vite UI + bundles the orchestrator, then serves BOTH from one port.
# Runs with zero secrets: without BOB_API_KEY the agent falls back to the mock engine.

FROM node:22-slim

# git is required: the app clones GitHub URLs and shells out to git for diffs/snapshots.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (better layer caching). Dev deps are needed for the build step below.
COPY package.json package-lock.json ./
RUN npm ci

# Bring in source, then build: `npm run build` emits dist/ (UI) + dist/server.mjs (API).
COPY . .
RUN npm run build

# Hosts (Render/Fly/Railway) inject PORT; the server reads process.env.PORT.
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# projectDir resolves from cwd (/app), so sample-target and dist/ are found here.
CMD ["node", "dist/server.mjs"]
