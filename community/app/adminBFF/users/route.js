import { proxyAdminJson } from "@/app/lib/adminGateway";

export const runtime = "nodejs";

export async function GET(req) {
  const searchParams = new URL(req.url).searchParams;
  return proxyAdminJson({
    request: req,
    path: "/auth/admin/users",
    query: {
      search: searchParams.get("search"),
      is_admin: searchParams.get("is_admin"),
      access_status: searchParams.get("access_status"),
      sort: searchParams.get("sort"),
      order: searchParams.get("order"),
      page: searchParams.get("page"),
      page_size: searchParams.get("page_size"),
    },
  });
}

export async function POST(req) {
  return proxyAdminJson({
    request: req,
    path: "/auth/admin/users",
    method: "POST",
    body: await req.json(),
  });
}
