import { getBrowserUser } from "@/app/lib/browserUser";
import { createNotificationsListHandler } from "@/app/lib/routes/notificationsRoute";

export const runtime = "nodejs";

export const GET = createNotificationsListHandler({
  requireUser: getBrowserUser,
});
