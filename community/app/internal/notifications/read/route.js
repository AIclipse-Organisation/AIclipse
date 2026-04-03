import { getForwardedUser } from "@/app/lib/internalUser";
import { createNotificationsReadHandler } from "@/app/lib/routes/notificationsRoute";

export const runtime = "nodejs";

export const POST = createNotificationsReadHandler({
  requireUser: getForwardedUser,
});
