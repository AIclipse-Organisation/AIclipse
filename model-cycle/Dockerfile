FROM mcr.microsoft.com/dotnet/sdk:8.0-jammy AS build
WORKDIR /src

COPY ModelCycle/ModelCycle.csproj ModelCycle/
RUN dotnet restore ModelCycle/ModelCycle.csproj

COPY ModelCycle/ ModelCycle/
RUN dotnet publish ModelCycle/ModelCycle.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0-jammy AS final
WORKDIR /app

COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:3000
EXPOSE 3000

ENTRYPOINT ["dotnet", "ModelCycle.dll"]
