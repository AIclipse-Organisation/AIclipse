import { getBrowserUser } from "@/app/lib/browserUser";
import { createNotificationsUnreadCountHandler } from "@/app/lib/routes/notificationsRoute";

export const runtime = "nodejs";

export const GET = createNotificationsUnreadCountHandler({
  requireUser: getBrowserUser,
});
