# Image de déploiement — utile pour un VPS, Railway, Fly.io, Render (mode Docker).
FROM node:20-alpine

WORKDIR /app

# Les dépendances d'abord : la couche est réutilisée tant que package.json ne change pas.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Le serveur applique lui-même les schémas SQL au démarrage (store.js).
CMD ["node", "server.js"]
