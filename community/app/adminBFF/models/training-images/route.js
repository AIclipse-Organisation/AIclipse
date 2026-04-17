import { proxyAdminJson } from "@/app/lib/adminGateway";

export const runtime = "nodejs";

export async function GET(req) {
  return proxyAdminJson({
    request: req,
    path: "/admin/models/training-images",
  });
}
