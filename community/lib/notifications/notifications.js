const NOTIFICATIONS_COLLECTION = "community.notifications";

const RETENTION_DAYS = 30;
const USER_CAP = 50;

let indexesReady = false;

export function retentionCutoffDate() {
  const ms = RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}

export async function ensureNotificationIndexes(db) {
  if (indexesReady) return;

  const col = db.collection(NOTIFICATIONS_COLLECTION);

  await Promise.all([
    col.createIndex({ recipient_user_id: 1, is_read: 1, last_event_at: -1 }),
    col.createIndex({ recipient_user_id: 1, last_event_at: -1 }),
    col.createIndex(
      {
        recipient_user_id: 1,
        actor_user_id: 1,
        post_id: 1,
        type: 1,
        vote_value: 1,
        is_read: 1,
      },
      { name: "notif_collapse_key" },
    ),
    col.createIndex({ created_at: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 }),
  ]);

  indexesReady = true;
}

export async function trimNotificationRetention(db) {
  const col = db.collection(NOTIFICATIONS_COLLECTION);
  await col.deleteMany({ created_at: { $lt: retentionCutoffDate() } });
}

export async function capNotificationsForUser(db, recipientUserId, limit = USER_CAP) {
  const col = db.collection(NOTIFICATIONS_COLLECTION);

  const overflow = await col
    .find(
      { recipient_user_id: recipientUserId },
      { projection: { _id: 1 } },
    )
    .sort({ last_event_at: -1, created_at: -1 })
    .skip(limit)
    .toArray();

  if (!overflow.length) return;

  await col.deleteMany({
    _id: { $in: overflow.map((x) => x._id) },
  });
}

function makeNotificationId() {
  return `n_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export async function recordCollapsedNotification(db, payload) {
  const {
    recipient_user_id,
    actor_user_id,
    post_id,
    type,
    vote_value = null,
    image_id = null,
  } = payload;

  if (!recipient_user_id || !actor_user_id || !post_id || !type) return;

  try {
    await ensureNotificationIndexes(db);
  } catch (err) {
    console.warn("[notifications] index ensure failed, continuing write:", String(err));
  }

  try {
    await trimNotificationRetention(db);
  } catch (err) {
    console.warn("[notifications] retention trim failed, continuing write:", String(err));
  }

  const col = db.collection(NOTIFICATIONS_COLLECTION);
  const now = new Date();

  const filter = {
    recipient_user_id,
    actor_user_id,
    post_id,
    type,
    is_read: false,
  };

  if (type === "vote" && vote_value) {
    filter.vote_value = vote_value;
  }

  const setOnInsert = {
    notification_id: makeNotificationId(),
    recipient_user_id,
    actor_user_id,
    post_id,
    type,
    created_at: now,
  };

  const setDoc = {
    is_read: false,
    last_event_at: now,
  };

  if (type === "vote" && vote_value) {
    setOnInsert.vote_value = vote_value;
  }

  if (image_id) {
    setDoc.image_id = image_id;
  }

  await col.updateOne(
    filter,
    {
      $setOnInsert: setOnInsert,
      $set: setDoc,
      $unset: { read_at: "" },
      $inc: { event_count: 1 },
    },
    { upsert: true },
  );

  try {
    await capNotificationsForUser(db, recipient_user_id, USER_CAP);
  } catch (err) {
    console.warn("[notifications] cap enforcement failed after write:", String(err));
  }
}
"" 