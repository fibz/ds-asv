# ASV Scanner API - Production Docker Image
FROM python:3.13-slim

# Install system dependencies for weasyprint, psycopg2, paramiko
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    libffi-dev \
    libssl-dev \
    libxml2-dev \
    libxslt-dev \
    libjpeg-dev \
    libpng-dev \
    libcap2-bin \
    libgdk-pixbuf-2.0-0 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libffi-dev \
    nmap \
    shared-mime-info \
    fonts-dejavu-core \
    fonts-liberation \
    && setcap cap_net_raw,cap_net_admin,cap_net_bind_service+eip /usr/bin/nmap \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd --create-home --shell /bin/bash app

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt requirements-dev.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/
COPY target-agents/ ./target-agents/

# Create evidence directory
RUN mkdir -p /tmp/asv-evidence && chown -R app:app /tmp/asv-evidence

# Switch to non-root user
USER app

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/v1/health')" || exit 1

# Run with gunicorn for production
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "4", "--worker-class", "uvicorn.workers.UvicornWorker", "app.api.main:app"]
