# Papier : l'application et son serveur de synchronisation dans une seule image.
#   docker build -t papier .
#   docker run -p 8787:8787 -v papier-data:/data -e PUBLIC_URL=https://notes.exemple.fr papier

# 1. Compilation de l'application (dist/).
FROM node:22-slim AS app
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

# 2. Serveur : Node seul (SQLite intégré à Node), quatre petites dépendances.
FROM node:22-slim
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force
COPY server/*.ts ./server/
COPY --from=app /src/dist ./dist
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    STATIC_DIR=/app/dist \
    NODE_NO_WARNINGS=1
# Le serveur tourne sans privilèges : le dossier des données lui appartient.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/info').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/main.ts"]
