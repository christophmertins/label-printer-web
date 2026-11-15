FROM ghcr.io/home-assistant/base-python:3.13-alpine3.24

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# libusb ist nur nötig, wenn das Addon selbst druckt (Backend pyusb); der
# Standardweg schickt den Auftrag per HTTP an die Instanz am Drucker.
RUN apk add --no-cache libusb

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

COPY app ./app
COPY config ./config
COPY templates ./templates
COPY run.py .
COPY run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/run.sh"]
