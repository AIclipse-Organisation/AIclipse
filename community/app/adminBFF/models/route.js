import { proxyAdminJson } from "@/app/lib/adminGateway";

export async function GET(req) {
  return proxyAdminJson({
    request: req,
    path: "/admin/models",
  });
}
