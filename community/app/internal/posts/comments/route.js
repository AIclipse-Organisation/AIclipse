import { getForwardedUser } from "@/app/lib/internalUser";
import { createCommentsRouteHandlers } from "@/app/lib/routes/commentsRoute";

export const runtime = "nodejs";

const handlers = createCommentsRouteHandlers({
  requireUser: getForwardedUser,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
