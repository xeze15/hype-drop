# Hype Drop container image.
# Uses the official Playwright image so Chromium + all its system libraries are
# already present (no `playwright install` needed at build time).
#
# IMPORTANT: keep this tag's version in lockstep with the "playwright" version
# in package.json — a mismatch means the npm client drives a browser build it
# wasn't made for. Both are pinned to 1.61.1.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

ENV NODE_ENV=production
# Browsers already ship in the base image at PLAYWRIGHT_BROWSERS_PATH.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# App source
COPY . .

# Data directory (mount a volume here to persist the SQLite DB).
RUN mkdir -p /app/data && chown -R pwuser:pwuser /app
USER pwuser

EXPOSE 3000
ENV HOST=0.0.0.0 PORT=3000

# Simple healthcheck against the unauthenticated endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
