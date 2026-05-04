FROM node:20-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build && npm prune --omit=dev

# --- runtime ---
FROM node:20-slim

WORKDIR /app

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./
COPY --from=build /app/app/lib ./app/lib
COPY --from=build /app/lib ./lib
COPY --from=build /app/*Worker.js ./
COPY --from=build /app/node_modules ./node_modules

EXPOSE 3000

ENV APP_ENV=prod
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

USER 1000

CMD ["node", "server.js"]
