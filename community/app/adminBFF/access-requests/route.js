import { proxyAdminJson } from "@/app/lib/adminGateway";

export const runtime = "nodejs";

export async function GET(req) {
  const searchParams = new URL(req.url).searchParams;
  return proxyAdminJson({
    path: "/auth/admin/access-requests",
    query: {
      search: searchParams.get("search"),
      page: searchParams.get("page"),
      page_size: searchParams.get("page_size"),
    },
  });
}
