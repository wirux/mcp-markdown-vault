# ── Stage 1: Build ──────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Prune dev dependencies
RUN npm prune --omit=dev

# ── Stage 2: Production ────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Non-root user for security
RUN addgroup -S mcp && adduser -S mcp -G mcp

# Copy compiled output and production deps
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Default vault mount point
RUN mkdir -p /vault && chown mcp:mcp /vault

# Environment defaults
ENV NODE_ENV=production
ENV VAULT_PATH=/vault
ENV OLLAMA_URL=http://host.docker.internal:11434
ENV OLLAMA_MODEL=nomic-embed-text
ENV OLLAMA_DIMENSIONS=768

USER mcp

ENTRYPOINT ["node", "dist/index.js"]
