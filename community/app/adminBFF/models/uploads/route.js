import { proxyAdminJson } from "@/app/lib/adminGateway";

export async function POST(req) {
  return proxyAdminJson({
    request: req,
    path: "/admin/models/uploads",
    method: "POST",
    body: await req.json(),
  });
}
