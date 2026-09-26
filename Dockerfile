# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY config ./config
COPY tsconfig.json ./
RUN npm install --global tsx@4
EXPOSE 3000
# config/ is expected to be MOUNTED over this by compose, so host-side edits
# apply without a rebuild. The COPY above only provides fallback defaults.
CMD ["tsx", "server/index.ts"]
