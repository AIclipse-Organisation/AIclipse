import { proxyAdminJson } from "@/app/lib/adminGateway";

export const runtime = "nodejs";

export async function POST(req) {
  return proxyAdminJson({
    path: "/admin/models/train",
    method: "POST",
    successTextKey: "message",
  });
}
