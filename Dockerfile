# Single-service image (P1-024): the API server also serves the built web app.
# Works on Render, Railway, Fly, any Docker host, or locally: docker run -p 8080:8080 investigation-room
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 IR_DATA_DIR=/data
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist/public apps/web/dist/public
# Integrity checker (P1-012): docker run --rm -v "$PWD/case:/case" investigation-room node ir.mjs verify /case
COPY --from=build /app/packages/cli/dist/ir.mjs ir.mjs
# Cases and the key vault (P1-013, P1-015); mount a volume here to keep them across deploys.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "apps/server/dist/index.mjs"]
