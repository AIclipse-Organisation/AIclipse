FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir \
    torch==2.4.1 \
    torchvision==0.19.1 \
    torchaudio==2.4.1 \
    --index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir -r requirements.txt

COPY detector_modules/ detector_modules/
COPY routers/ routers/ 
COPY routers/swagger/ routers/swagger/
COPY main-detector.py .

CMD ["uvicorn", "main-detector:app", "--host", "0.0.0.0", "--port", "3000"]