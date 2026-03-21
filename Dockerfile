FROM node:22-bookworm AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


FROM node:22-bookworm AS server-builder

WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/ ./
RUN npm run build


FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=server-builder /app/server/dist ./dist
COPY --from=server-builder /app/server/schemas ./schemas
COPY --from=server-builder /app/server/data ./data
COPY --from=server-builder /app/server/config.example.yaml ./config.example.yaml
COPY --from=server-builder /app/server/config.example-server.yaml ./config.example-server.yaml
COPY --from=frontend-builder /app/frontend/dist ./public

RUN chown -R node:node /app/server

USER node

EXPOSE 8920

VOLUME ["/app/server/data"]

CMD ["node", "dist/index.js"]
