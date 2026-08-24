FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    AGENT_API_HOST=0.0.0.0 \
    AGENT_API_PORT=8787

# The official DSH plugins declare their runtime tool package as a peer plus a
# workspace dev dependency. Install it at the image root as well, so Node can
# resolve it from every local plugin directory. .dockerignore keeps host
# credentials and local Harness state outside the build context; no dependency
# installation script receives a secret.
COPY . .
# npm's advisory service treats URL-installed packages as an unconstrained
# version and falsely reports the fixed SheetJS 0.20.3 tarball. The release is
# pinned and exercised by tests/phase10/security-dependencies.test.mjs.
RUN apk add --no-cache --virtual .native-build-deps python3 make g++ \
  && npm install --include=optional --audit=false \
  && npm install --include=optional --no-save --audit=false @deepseek-ai/dsh-tools@0.1.1-rc.2 \
  && npm ci --prefix runtime --include=optional --audit=false \
  && npm rebuild --prefix runtime node-pty --build-from-source \
  && mkdir -p /app/.dsh-platform \
  && npm cache clean --force \
  && apk del .native-build-deps \
  && chown -R node:node /app

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["sh", "-c", "node scripts/write-overlays.mjs && node scripts/start-container.mjs"]
