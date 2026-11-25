# PocketFolio engine (plan §14). linux/amd64, as Cloudflare Containers run it.
FROM --platform=linux/amd64 python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /src
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM --platform=linux/amd64 python:3.12-slim
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin engine
COPY --from=build /opt/venv /opt/venv
WORKDIR /app
COPY engine ./engine
COPY entrypoint.sh ./
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080
USER engine
EXPOSE 8080
# Run with a read-only root filesystem and tmpfs /tmp (docker run --read-only --tmpfs /tmp). The engine writes nothing.
ENTRYPOINT ["/app/entrypoint.sh"]
