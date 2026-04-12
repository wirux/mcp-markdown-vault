# ── Stage 1: Build ──────────────────────────────────────────────────
# Using slim (Debian/glibc) instead of Alpine (musl) because
# onnxruntime-node (used by @huggingface/transformers) requires glibc.
FROM node:22-slim AS builder

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
FROM node:22-slim AS production

WORKDIR /app

# Non-root user for security
RUN groupadd --system mcp && useradd --system --gid mcp mcp

# Copy compiled output and production deps
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Default vault mount point
RUN mkdir -p /vault && chown mcp:mcp /vault

# Writable caches for @huggingface/transformers (non-root user):
#   - /home/mcp/.cache/huggingface — model file cache (controlled by HF_HOME)
#   - .../transformers/.cache     — internal HTTP response cache (hardcoded in library)
RUN mkdir -p /home/mcp/.cache/huggingface \
    /app/node_modules/@huggingface/transformers/.cache && \
    chown -R mcp:mcp /home/mcp /app/node_modules/@huggingface/transformers/.cache

# Environment defaults
ENV NODE_ENV=production
ENV VAULT_PATH=/vault
# OLLAMA_URL intentionally unset — local embeddings by default (zero-setup).
# Set OLLAMA_URL at runtime to enable Ollama.
ENV OLLAMA_MODEL=nomic-embed-text
ENV OLLAMA_DIMENSIONS=768
ENV MCP_TRANSPORT_TYPE=stdio
ENV PORT=3000
ENV HF_HOME=/home/mcp/.cache/huggingface

# Expose SSE port (used when MCP_TRANSPORT_TYPE=sse)
EXPOSE 3000

USER mcp

ENTRYPOINT ["node", "dist/index.js"]
