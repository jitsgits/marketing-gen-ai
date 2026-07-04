# --- Stage 1: Build Angular application ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package descriptors first to utilize layer caching
COPY package*.json ./
RUN npm ci

# Copy sources and build the project
COPY . .
RUN npm run build -- --configuration=production

# --- Stage 2: Production Nginx Server ---
FROM nginx:alpine

# Copy compilation output (Angular application output directory is dist/frontend/browser)
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html

# Overwrite Nginx default configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
