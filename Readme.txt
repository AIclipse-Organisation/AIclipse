AIclipse Operational README
Generated from the repository state on 2026-04-25.

========================================================================
1. Purpose
========================================================================

This file is the operational runbook for AIclipse.
It is written to be self-contained: a developer should be able to boot the
local system by following only this file.

Primary source of truth for the architecture contract:

- ARCHITECTURE.md

If behavior in old notes ever differs from the code, trust:

1. ARCHITECTURE.md
2. source code
3. Kubernetes manifests


========================================================================
2. What AIclipse is
========================================================================

AIclipse is a Kubernetes-based microservices platform for AI image detection.

The current system contains nine application services:

- auth
  FastAPI + MongoDB. Handles identity, JWTs, API keys, and admin actions.

- gateway
  FastAPI. Main trust boundary. Validates auth and proxies requests to backend
  services.

- client
  Flask. Main browser BFF and server-rendered website.

- community
  Next.js. Community UI under /community, internal routes, adminBFF, and
  background workers.

- billing
  FastAPI + MongoDB + Stripe. Checkout, subscription state, and webhook logic.

- media
  FastAPI + MongoDB + MinIO/S3. Image metadata and presigned URL generation.

- detector
  FastAPI + PyTorch/Transformers. AI image inference service.

- model-cycle
  ASP.NET Core + SQLite + Python. Model upload, deployment, training workflow,
  and confidence scoring.

- email-worker
  FastAPI + Redis Streams + Gmail. Email dispatch worker and DLQ replay API.

Core data systems:

- MongoDB
- Redis
- MinIO
- SQLite inside model-cycle


========================================================================
3. The recommended way to run the system
========================================================================

Use Skaffold from the repository root.
That is the intended local development path.

The repository already contains the local Kubernetes manifests, local dev
secrets, ingress rules, and service wiring needed for a full local boot.

You do NOT need to manually create per-service env files if you use the default
Kubernetes + Skaffold workflow described below.


========================================================================
4. Prerequisites
========================================================================

Required:

- Docker Desktop
- Kubernetes enabled inside Docker Desktop
- kubectl
- Skaffold
- ingress-nginx controller

Helpful optional tools:

- MongoDB Compass
- Redis Insight
- mkcert, if you want local HTTPS instead of HTTP-only development

Recommended runtime/toolchain versions if you work on services directly:

- Python 3.11 for the Python services
- Node.js 20 for the community/client JS workflows
- .NET 8 for model-cycle

Windows notes:

- Docker Desktop is the normal local cluster runtime.
- If you install Skaffold with Chocolatey, the simplest command is:

  choco install -y skaffold

If you install Skaffold another way, that is also fine. The requirement is
simply that the `skaffold` command is available in your terminal.


========================================================================
5. Hosts file setup
========================================================================

Add this line to your hosts file:

127.0.0.1 aiclipse.local storage.aiclipse.local

On Windows:

1. Open Notepad as Administrator.
2. Open:

   C:\Windows\System32\drivers\etc\hosts

3. Add the line above.
4. Save the file.

Without this step, the local ingress hostnames will not resolve correctly.


========================================================================
6. Install ingress-nginx
========================================================================

Run:

kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.13.3/deploy/static/provider/cloud/deploy.yaml

Wait until the ingress controller is ready:

kubectl -n ingress-nginx get pods

You should eventually see the ingress-nginx controller pod in a Running state.


========================================================================
7. Optional local HTTPS
========================================================================

HTTP-only development works without this section.
Only do this if you want HTTPS on aiclipse.local and storage.aiclipse.local.

If you have mkcert installed, run:

mkcert -install
New-Item -ItemType Directory -Force infra\k8s-dev\certs | Out-Null
mkcert -cert-file infra\k8s-dev\certs\aiclipse.local+1.pem `
  -key-file infra\k8s-dev\certs\aiclipse.local+1-key.pem `
  aiclipse.local storage.aiclipse.local

After that, `skaffold dev` will automatically sync the local TLS secret before
deploying ingress.

If you skip this, the stack still works over HTTP.


========================================================================
8. Boot the full local system
========================================================================

From the repository root, run:

skaffold dev

This is the main development command for AIclipse.

What it does:

- builds all service images locally
- deploys infrastructure and services through infra/kustomization.yaml
- applies local dev secrets and config
- live-syncs supported file types into running containers
- port-forwards a few important services back to your machine

The main build artifacts in this flow are:

- aiclipse/auth
- aiclipse/email-worker
- aiclipse/gateway
- aiclipse/media
- aiclipse/detector
- aiclipse/model-cycle
- aiclipse/billing
- aiclipse/client
- aiclipse/community


========================================================================
9. What should come up
========================================================================

After a successful boot, the important entry points are:

- http://aiclipse.local
- http://storage.aiclipse.local

If you configured local TLS, these should also work:

- https://aiclipse.local
- https://storage.aiclipse.local

Skaffold port-forwards these services by default:

- gateway on localhost:8080
- MongoDB on localhost:27017
- MinIO API on localhost:9000
- MinIO console on localhost:9001
- Redis on localhost:6379


========================================================================
10. Quick validation after boot
========================================================================

Open another terminal and run:

kubectl get pods
kubectl get svc
kubectl get ingress

Expected local smoke checks:

1. The pods for auth, gateway, client, community, billing, media, detector,
   model-cycle, email-worker, mongo, redis, and s3 should be Running or become
   Running after first startup.

2. Opening http://aiclipse.local in a browser should load the main site.

3. Opening http://127.0.0.1:9001 should load the MinIO console.

4. The following health endpoints should answer if you port-forward or reach
   the services through the cluster:

   - gateway: /healthz
   - auth: /healthz
   - media: /healthz
   - billing: /healthz
   - detector: /healthz
   - email-worker: /healthz
   - client: /healthz
   - community: /community/healthz
   - model-cycle: /healthz


========================================================================
11. Local credentials and access details
========================================================================

The default local Kubernetes dev setup already injects local credentials into
the pods.

Useful local access values:

MongoDB:

- host: 127.0.0.1
- port: 27017
- username: root
- password: devpass
- database: aiclipse
- URI:

  mongodb://root:devpass@127.0.0.1:27017/?authSource=admin&directConnection=true

Redis:

- host: 127.0.0.1
- port: 6379
- password: devpass
- URI:

  redis://default@127.0.0.1:6379

If your Redis client prompts for a password, use:

- devpass

MinIO:

- console URL: http://127.0.0.1:9001
- access key / username: minio
- secret key / password: devpassai


========================================================================
12. What works locally without extra changes
========================================================================

The system is designed to boot locally with the repository’s development
Kubernetes secrets and config.

That means:

- the services can start without you manually creating env files
- MongoDB, Redis, and MinIO are provisioned in the cluster
- ingress routes are already defined
- internal service URIs are already wired through Kubernetes services

Important limitations of the default local boot:

- billing uses development placeholder Stripe secrets unless you replace them
- email-worker uses development placeholder Gmail OAuth values unless you
  replace them

Effect:

- the system can boot
- UI and core service wiring can be tested
- real Stripe checkout and real Gmail delivery are not expected to work until
  you supply valid external-provider credentials


========================================================================
13. Repository layout
========================================================================

Top-level directories:

- auth
- billing
- client
- community
- detector
- email-worker
- gateway
- infra
- media
- model-cycle
- swagger-docs

Important subfolders:

- client/routes
- client/services
- client/templates
- client/static
- community/app
- community/lib
- community/scripts
- gateway/app/core
- gateway/app/routers
- auth/app/core
- auth/app/db
- auth/app/routers
- auth/app/services
- detector/detector_modules
- detector/routers
- model-cycle/ModelCycle/Controllers
- model-cycle/ModelCycle/Services
- model-cycle/ModelCycle/Repositories
- infra/k8s
- infra/k8s-dev
- infra/k8s-prod

Generated folders that are not part of the architecture:

- node_modules
- .pytest_cache
- __pycache__
- bin
- obj
- pytest-cache-files-*


========================================================================
14. Public routing and trust boundaries
========================================================================

Development routing:

- / goes to client
- /community goes to community
- /api/* goes to gateway, with /api stripped by ingress before gateway sees it
- storage.aiclipse.local goes to MinIO/object storage

Core trust model:

- browser traffic goes to client or community
- client and community operate as browser-facing BFFs
- gateway is the main auth and trust boundary for backend calls
- backend services trust forwarded identity from gateway
- internal service-to-service calls use X-Internal-Token where required


========================================================================
15. Manual build commands
========================================================================

There is no root Makefile.
The normal build path is Docker per service or Skaffold at the root.

Examples:

docker build -t aiclipse/auth auth
docker build -t aiclipse/gateway gateway
docker build -t aiclipse/media media
docker build -t aiclipse/detector detector
docker build -t aiclipse/billing billing
docker build -t aiclipse/email-worker email-worker
docker build -t aiclipse/client client
docker build -t aiclipse/community community
docker build -t aiclipse/model-cycle model-cycle


========================================================================
16. Running individual services outside Kubernetes
========================================================================

This is an advanced workflow.
Use it only if you intentionally want to debug one service in isolation.

Important:

- the full system is meant to run together
- many services depend on internal URIs, Redis, MongoDB, MinIO, or the central
  config URL
- manual local startup means you must recreate those dependencies yourself

Typical direct service commands:

Python services:

- auth

  cd auth
  python -m pip install -U pip
  pip install -r requirements-dev.txt
  uvicorn app.main_auth:app --host 0.0.0.0 --port 3000 --reload

- gateway

  cd gateway
  python -m pip install -U pip
  pip install -r requirements-dev.txt
  uvicorn app.main_gateway:app --host 0.0.0.0 --port 8080 --reload

- media

  cd media
  python -m pip install -U pip
  pip install -r requirements-dev.txt
  uvicorn main-media:app --host 0.0.0.0 --port 3000 --reload

- detector

  cd detector
  python -m pip install -U pip
  pip install -r requirements-dev.txt
  uvicorn main-detector:app --host 0.0.0.0 --port 3000 --reload

- billing

  cd billing
  python -m pip install -U pip
  pip install -r requirements-dev.txt
  uvicorn main-billing:app --host 0.0.0.0 --port 3000 --reload

- email-worker

  cd email-worker
  python -m pip install -U pip
  pip install -r requirements-dev.txt
  uvicorn main-email-worker:app --host 0.0.0.0 --port 3000 --reload

- client

  cd client
  python -m pip install -U pip
  pip install -r requirements-dev.txt
  python main-client.py

Community:

- cd community
- npm ci
- npm run dev

Model-cycle:

- cd model-cycle
- dotnet restore Tests/Tests.csproj
- python -m pip install -U pip
- pip install -r ModelCycle/requirements.txt
- dotnet run --project ModelCycle/ModelCycle.csproj


========================================================================
17. Testing
========================================================================

Per-service CI uses unit tests plus k3d smoke deployments.

Local test commands:

Python services:

- cd auth          && python -m pytest tests -q
- cd billing       && python -m pytest tests -q
- cd gateway       && python -m pytest tests -q
- cd media         && python -m pytest tests -q
- cd detector      && python -m pytest tests -q
- cd email-worker  && python -m pytest tests -q
- cd client        && python -m pytest tests -q

JavaScript:

- cd client     && npm test
- cd community  && npm test

.NET:

- cd model-cycle && dotnet test Tests/Tests.csproj --no-restore --verbosity minimal


========================================================================
18. Focused model-cycle workflow
========================================================================

If you are only working on model-cycle, there is also a focused Skaffold path:

skaffold dev -f skaffold-model-cycle.yaml

That path builds and deploys:

- model-cycle
- MinIO
- the model-cycle development S3 secret


========================================================================
19. Important environment surfaces
========================================================================

If you stay on the default Kubernetes + Skaffold path, you normally do not need
to manage these by hand. This list is here so you understand the wiring.

Common cross-service settings:

- INTERNAL_AUTH_TOKEN
- ALLOWED_ORIGINS
- CLIENT_URL
- CENTRAL_CONFIG_URL
- S3_ENDPOINT
- S3_PUBLIC_ENDPOINT
- MONGO_URI
- MONGO_DB
- REDIS_URI

Service-specific highlights:

- auth
  JWT_KEY, API_KEY_PEPPER, AUTH_EVENT_STREAM

- gateway
  AUTH_URI, BILLING_URI, COMMUNITY_URI, MEDIA_URI, DETECTOR_URI,
  MODEL_CYCLE_URI, DETECTION_TOKEN_SECRET

- billing
  STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET

- client
  FLASK_SECRET_KEY, GATEWAY_URI, COMMUNITY_URI

- community
  GATEWAY_URI, AUTH_URI, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD

- detector
  MODEL_VERSION, DETECTOR_MAX_INFLIGHT, DETECTOR_INFER_CONCURRENCY,
  DETECTOR_QUEUE_TIMEOUT_S, DETECTOR_INFER_TIMEOUT_S, MINIO_BUCKET_NAME

- model-cycle
  AUTH_URI, DETECTOR_URI, TRAINING_DATA_PATH, MINIO_BUCKET_NAME

- email-worker
  GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN,
  GMAIL_SENDER_EMAIL


========================================================================
20. Troubleshooting first boot
========================================================================

If the system does not come up, check these in order:

1. Docker Desktop is running.

2. Kubernetes is enabled inside Docker Desktop.

3. Your hosts file contains:

   127.0.0.1 aiclipse.local storage.aiclipse.local

4. ingress-nginx is installed:

   kubectl -n ingress-nginx get pods

5. The cluster pods exist and are progressing:

   kubectl get pods

6. The ingress resources exist:

   kubectl get ingress

7. Skaffold is still running and not stuck on a failed build.

Common causes:

- missing hosts file entries
- ingress-nginx not installed
- Docker Desktop Kubernetes disabled
- first build still in progress
- local TLS certs configured incorrectly, if you chose the HTTPS path


========================================================================
21. Files worth reading after the system boots
========================================================================

If you want to understand the system after you get it running, read these next:

1. ARCHITECTURE.md
2. skaffold.yaml
3. infra/kustomization.yaml
4. infra/k8s-dev/dev-secrets.yaml
5. client/main-client.py
6. community/middleware.js
7. gateway/app/main_gateway.py
8. auth/app/main_auth.py
9. media/main-media.py
10. detector/main-detector.py
11. model-cycle/ModelCycle/Program.cs


========================================================================
22. Final guidance
========================================================================

For normal development, prefer:

- running the full stack with skaffold dev
- treating ARCHITECTURE.md as the contract
- using Kubernetes manifests as the deployment truth
- using this file as the main local boot guide

If you change cross-service behavior, update the contract in ARCHITECTURE.md in
the same change set.
