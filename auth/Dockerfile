FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd --system --uid 1000 --no-create-home appuser
USER 1000

CMD ["uvicorn", "app.main_auth:app", "--host", "0.0.0.0", "--port", "3000"]
