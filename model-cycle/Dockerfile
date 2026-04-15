FROM mcr.microsoft.com/dotnet/sdk:8.0-jammy AS build
WORKDIR /src

COPY ModelCycle/ModelCycle.csproj ModelCycle/
RUN dotnet restore ModelCycle/ModelCycle.csproj

COPY ModelCycle/ ModelCycle/

# optimized release build
RUN dotnet publish ModelCycle/ModelCycle.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0-jammy AS final
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/python3 /usr/bin/python

COPY --from=build /src/ModelCycle/requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY --from=build /app/publish .

# --- CRITICAL PRODUCTION SETTINGS ---
ENV ASPNETCORE_ENVIRONMENT=Production
ENV APP_ENV=prod
ENV ASPNETCORE_URLS=http://+:3000
EXPOSE 3000

# Stricter permissions
RUN useradd --system --uid 1000 --create-home --shell /usr/sbin/nologin appuser && \
    mkdir -p training_jobs && \
    chown 1000:1000 training_jobs && \
    chmod 755 training_jobs

# Numeric UID keeps Kubernetes runAsNonRoot verification simple.
USER 1000

ENTRYPOINT ["dotnet", "ModelCycle.dll"]
