import { getForwardedUser, getOptionalForwardedUser, buildGatewayIdentityHeaders } from "@/app/lib/internalUser";
import { createPostsRouteHandlers } from "@/app/lib/routes/postsRoute";

export const runtime = "nodejs";

const handlers = createPostsRouteHandlers({
  requireUser: getForwardedUser,
  optionalUser: getOptionalForwardedUser,
  buildGatewayIdentityHeaders,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
