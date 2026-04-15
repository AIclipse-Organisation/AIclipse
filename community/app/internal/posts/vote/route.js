import { getForwardedUser } from "@/app/lib/internalUser";
import { createVoteHandler } from "@/app/lib/routes/voteRoute";

export const runtime = "nodejs";

export const POST = createVoteHandler({
  requireUser: getForwardedUser,
});
