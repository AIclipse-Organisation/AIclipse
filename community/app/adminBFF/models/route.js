import { proxyAdminJson } from "@/app/lib/adminGateway";

export async function GET() {
  return proxyAdminJson({
    path: "/admin/models",
  });
}
