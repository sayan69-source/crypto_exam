FROM python:3.12-slim

WORKDIR /app

# System dependencies for gmpy2 and cryptography
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgmp-dev \
    libmpfr-dev \
    libmpc-dev \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
RUN pip install --no-cache-dir -e ".[dev]" 2>/dev/null || pip install --no-cache-dir .

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
