FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY api ./api
COPY agents ./agents
COPY data ./data
COPY mcp_integration ./mcp_integration

ENV PYTHONPATH=/app
EXPOSE 8080

CMD ["uvicorn", "api.main:app", "--host=0.0.0.0", "--port=8080", "--workers=1"]
