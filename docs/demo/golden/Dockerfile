# @file apps/demo-service/Dockerfile (golden copy: docs/demo/golden/Dockerfile)
# @phase P3 (golden) / generated live by IBM Bob (deployment-asset-authoring skill)
# @purpose Multi-stage build for IBM Cloud Code Engine "build from source". Produces a tiny runtime image on port 8080.
# @agentNotes Build context is apps/demo-service only — do not COPY files from outside it.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/dist/server.mjs ./server.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
