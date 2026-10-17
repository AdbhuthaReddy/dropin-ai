FROM node:22-bookworm-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY shared/ /app/shared/
ENV NEXT_PUBLIC_API_BASE_URL=/ NEXT_PUBLIC_CLOUD_MODE=true
RUN npm run build

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 NODE_ENV=production PORT=8080
RUN apt-get update && apt-get install -y --no-install-recommends nginx-light libstdc++6 \
    && rm -rf /var/lib/apt/lists/* && useradd --uid 10001 --create-home app
COPY --from=web /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt
COPY backend/app /app/backend/app
COPY shared /app/shared
COPY --from=web --chown=app:app /app/frontend/.next/standalone /app/web/
COPY --from=web --chown=app:app /app/frontend/.next/static /app/web/frontend/.next/static
COPY deploy/nginx.conf /app/nginx.conf
COPY deploy/serve.py /app/serve.py
USER app
CMD ["python", "/app/serve.py"]
