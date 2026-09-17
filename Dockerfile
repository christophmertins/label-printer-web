FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        libusb-1.0-0 \
        fonts-dejavu-core \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY config ./config
COPY templates ./templates
COPY run.py .

# Bundle the DejaVu fonts into the static assets so the browser preview
# renders text exactly like the printed output.
RUN mkdir -p /app/app/static/fonts \
    && cp /usr/share/fonts/truetype/dejavu/*.ttf /app/app/static/fonts/ 2>/dev/null || true

# Printer + templates are user config, keep them in volumes.
VOLUME ["/app/config", "/app/templates"]

EXPOSE 5001

CMD ["gunicorn", "--bind", "0.0.0.0:5001", "--workers", "1", "--threads", "8", "--timeout", "120", "app:create_app()"]