# Stage 1: Build dependencies and install node modules
FROM node:20-slim AS builder

# Install build dependencies for native modules (sharp, better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Runtime image
FROM node:20-slim

WORKDIR /app

# Copy node_modules from builder stage
COPY --from=builder /app/node_modules ./node_modules
# Copy application code
COPY . .

# Ensure storage and data directories exist inside the container
RUN mkdir -p data storage/tmp storage/media

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["npm", "start"]
