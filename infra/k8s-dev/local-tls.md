# Local TLS for `aiclipse.local`

Dev ingress now supports both HTTP and HTTPS.

- HTTP keeps working by default.
- HTTPS starts working after you create the `aiclipse-local-tls` secret.
- There is no forced redirect from HTTP to HTTPS, so you can switch between them while testing.
- `skaffold dev` now runs a pre-deploy hook that syncs the TLS secret automatically if local cert files exist.

## Create a local certificate

On Windows with `mkcert` installed:

```powershell
mkcert -install
New-Item -ItemType Directory -Force infra\k8s-dev\certs | Out-Null
mkcert -cert-file infra\k8s-dev\certs\aiclipse.local+1.pem `
  -key-file infra\k8s-dev\certs\aiclipse.local+1-key.pem `
  aiclipse.local storage.aiclipse.local
```

Then start or restart:

```powershell
skaffold dev
```

The pre-deploy hook will create or update `aiclipse-local-tls` before the ingress manifests are applied.
If no cert files are present, the hook skips TLS secret sync and HTTP-only dev keeps working.

## URLs

- App: `http://aiclipse.local` or `https://aiclipse.local`
- Storage: `http://storage.aiclipse.local` or `https://storage.aiclipse.local`

`ALLOWED_ORIGINS` in dev now allows both schemes, and gateway forwards the active external scheme to billing/media so checkout redirects and presigned image URLs match the way the browser reached the app.
