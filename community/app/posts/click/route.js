import { getBrowserUser } from "@/app/lib/browserUser";
import { createClickRouteHandler } from "@/app/lib/routes/clickRoute";

export const runtime = "nodejs";

export const POST = createClickRouteHandler({
  requireUser: getBrowserUser,
});
