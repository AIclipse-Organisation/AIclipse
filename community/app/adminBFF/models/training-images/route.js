import { proxyAdminJson } from "@/app/lib/adminGateway";

export const runtime = "nodejs";

export async function GET(req) {
  return proxyAdminJson({
    path: "/admin/models/training-images",
  });
}
