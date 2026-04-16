FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd --system --uid 1000 --create-home --home-dir /home/appuser appuser
USER 1000

ENV HOME=/home/appuser

CMD ["uvicorn", "main-email-worker:app", "--host", "0.0.0.0", "--port", "3000"]
