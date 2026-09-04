FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY apps/scheduler-server/package.json apps/scheduler-server/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/threads-client/package.json packages/threads-client/package.json
RUN pnpm install --frozen-lockfile
COPY apps/scheduler-server apps/scheduler-server
COPY packages/contracts packages/contracts
COPY packages/database packages/database
COPY packages/shared packages/shared
COPY packages/threads-client packages/threads-client
RUN pnpm --filter @threadflow-os/scheduler-server... build

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 8788
CMD ["node", "apps/scheduler-server/dist/server.js"]
