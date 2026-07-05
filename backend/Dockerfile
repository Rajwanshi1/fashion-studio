# ---- build: deps + compile ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Migrations live next to dist/; index.ts resolves ./db/migrations from cwd (/app).
COPY db ./db
COPY package.json ./
EXPOSE 3001
CMD ["node", "dist/index.js"]
