FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd --system --uid 1000 --no-create-home appuser
USER appuser

CMD ["uvicorn", "app.main_gateway:app", "--host", "0.0.0.0", "--port", "8080", "--timeout-keep-alive", "300"]