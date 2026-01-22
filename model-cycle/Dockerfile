FROM mcr.microsoft.com/dotnet/sdk:8.0-jammy AS build
WORKDIR /src

COPY ModelCycle/ModelCycle.csproj ModelCycle/
RUN dotnet restore ModelCycle/ModelCycle.csproj

COPY ModelCycle/ ModelCycle/
RUN dotnet publish ModelCycle/ModelCycle.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0-jammy AS final
WORKDIR /app

# run python install for training script
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# create a symlink so 'Process.Start("python")' which allows .net to run python
RUN ln -s /usr/bin/python3 /usr/bin/python

# get training script python packages
COPY --from=build /src/ModelCycle/requirements.txt .

RUN pip3 install --no-cache-dir -r requirements.txt

COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:3000
EXPOSE 3000

# gives .net permission to read/write in temp training jobs folders
RUN mkdir -p training_jobs && chmod 777 training_jobs

ENTRYPOINT ["dotnet", "ModelCycle.dll"]
