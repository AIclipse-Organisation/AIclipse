import { getForwardedUser } from "@/app/lib/internalUser";
import { createClickRouteHandler } from "@/app/lib/routes/clickRoute";

export const runtime = "nodejs";

export const POST = createClickRouteHandler({
  requireUser: getForwardedUser,
});
