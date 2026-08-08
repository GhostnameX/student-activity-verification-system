FROM oven/bun:1.3

WORKDIR /app

COPY package.json bun.lock ./
COPY packages/db/package.json packages/db/package.json
COPY apps/api/package.json apps/api/package.json

RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production

EXPOSE 3000

CMD ["bun", "run", "--filter", "@ua/api", "start"]
