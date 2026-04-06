FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd --system --uid 1000 --no-create-home appuser
USER appuser

ENV APP_ENV=prod

CMD ["gunicorn", "--bind", "0.0.0.0:3000", "--workers", "2", "--access-logfile", "-", "--error-logfile", "-", "--logger-class", "gunicorn_logger.HealthLogger", "wsgi:app"]