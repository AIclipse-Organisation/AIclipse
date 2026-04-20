import { buildAdminError, proxyAdminJson } from "@/app/lib/adminGateway";

export const runtime = "nodejs";

export async function GET(req) {
  return proxyAdminJson({
    request: req,
    path: "/admin/models/current",
    onError: (response) => {
      if (response.status === 404) {
        return buildAdminError(404, "No active model");
      }
      return null;
    },
  });
}
