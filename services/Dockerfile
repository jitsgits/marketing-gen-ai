# --- Stage 1: Build Dependencies ---
FROM python:3.11-slim AS builder

WORKDIR /build

# Install basic compile tools if any package requires it
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install dependencies to a local folder
RUN pip install --no-cache-dir --user -r requirements.txt

# --- Stage 2: Production Runtime ---
FROM python:3.11-slim AS runner

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /root/.local /root/.local
COPY . /app

# Ensure local bin is in PATH
ENV PATH=/root/.local/bin:$PATH
ENV PYTHONPATH=/app

# Expose FastAPI default port
EXPOSE 8000

# Default command (overridden in docker-compose for the worker)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
