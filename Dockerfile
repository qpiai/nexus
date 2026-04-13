# ============================================================
# QpiAI Nexus — Docker Build
# ============================================================
# Stage 1: Build the Next.js application
# Stage 2: Slim runtime with Python + uv for ML operations
# ============================================================

# ---------- Stage 1 — Builder ----------
FROM node:20-slim AS builder

WORKDIR /build

# Copy package manifests first for better layer caching
COPY llm-integration-platform/package.json llm-integration-platform/package-lock.json ./

# Clean install from lockfile
RUN npm ci

# Copy the rest of the source
COPY llm-integration-platform/ .

# Build the Next.js app
RUN npm run build

# ---------- Stage 2 — Runtime ----------
FROM node:20-slim

WORKDIR /app

# Install Python 3, build tools, and uv (fast Python package manager)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        cmake \
        build-essential \
        git \
        curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -LsSf https://astral.sh/uv/install.sh | sh

# Make uv available in PATH
ENV PATH="/root/.local/bin:${PATH}"

# Copy built application from builder stage
COPY --from=builder /build/.next ./.next
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/public ./public
COPY --from=builder /build/package.json ./package.json
COPY --from=builder /build/next.config.mjs ./next.config.mjs

# Copy Python scripts and requirements
COPY llm-integration-platform/scripts ./scripts

# Create volume mount points for persistent data
RUN mkdir -p /app/output /app/data /app/venvs

# Copy and set up the entrypoint script
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENV PORT=7777
EXPOSE ${PORT}

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["sh", "-c", "node_modules/.bin/next start -p ${PORT}"]
