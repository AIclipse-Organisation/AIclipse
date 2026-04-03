import { proxyAdminJson } from "@/app/lib/adminGateway";

export const runtime = "nodejs";

export async function GET(req) {
  const searchParams = new URL(req.url).searchParams;
  return proxyAdminJson({
    path: "/auth/admin/user-deletion-logs",
    query: {
      page: searchParams.get("page") || "1",
      page_size: searchParams.get("page_size") || "20",
    },
  });
}
