# syntax=docker/dockerfile:1

# ---- build stage: install everything and build the frontend ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage: production deps + server source + built frontend ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=80
# Only production dependencies (Fastify, Sentry, tsx). React and the build
# toolchain stay in the build stage, so the runtime image stays small.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
# The server runs TypeScript directly via tsx, so ship the server source and
# its bundled demo fixtures, plus the built static frontend.
COPY server ./server
COPY --from=build /app/dist ./dist
EXPOSE 80
CMD ["node_modules/.bin/tsx", "server/index.ts"]
