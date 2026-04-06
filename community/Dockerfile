FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build && npm prune --omit=dev && \
    chown -R node:node .next

EXPOSE 3000

ENV APP_ENV=prod

USER 1000

CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
