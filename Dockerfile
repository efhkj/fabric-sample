FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci
COPY client ./client
COPY server ./server
RUN npm run db:generate && npm run build
ENV NODE_ENV=production
WORKDIR /app/server
EXPOSE 3001
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/main.js"]
