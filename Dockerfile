# syntax=docker/dockerfile:1.7
# Azure Linux (formerly CBL-Mariner) base — glibc, MS-supported, plays well with
# Defender for Containers / ACA / ACR. Avoids musl-related native module issues.
FROM mcr.microsoft.com/azurelinux/base/nodejs:20 AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM mcr.microsoft.com/azurelinux/base/nodejs:20 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN mkdir -p public && npm run build

FROM mcr.microsoft.com/azurelinux/base/nodejs:20 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1
RUN tdnf install -y shadow-utils && tdnf clean all \
 && groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs --home-dir /app --shell /sbin/nologin nextjs
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
