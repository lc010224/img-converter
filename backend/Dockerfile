FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends webp inotify-tools \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY frontend/index.html ./app/static/index.html
COPY frontend/app.js ./app/static/app.js
COPY frontend/styles.css ./app/static/styles.css

EXPOSE 7745

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7745"]
