FROM node:22-bookworm-slim
# git: shallow fetches of service and library repos for passports
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/cache && chown -R node:node /app
USER node
ENV PORT=4000 NODE_ENV=production
EXPOSE 4000
CMD ["node", "cli.js", "start"]
