FROM node:24-slim

RUN npm install --global npm@latest corepack@latest && corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=secret,id=npm_token \
  printf '@karasu-lab:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=%s\n' "$(cat /run/secrets/npm_token)" > .npmrc \
  && pnpm install --frozen-lockfile --ignore-scripts \
  && rm -f .npmrc

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000 25565

CMD ["node_modules/.bin/tsx", "src/gateway/index.ts"]
