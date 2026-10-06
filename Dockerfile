# pvzlite dedicated server + web client
#   docker build -t pvzlite .
#   docker run -p 7777:7777 pvzlite      → open http://localhost:7777
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx vite build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=7777
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/shared ./src/shared
EXPOSE 7777
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:7777/health || exit 1
USER node
CMD ["node", "server/index.js", "--port", "7777"]
