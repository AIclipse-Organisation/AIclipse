const POSTS_COLLECTION = "community.posts";
const COMMENTS_COLLECTION = "community.comments";
const VOTES_COLLECTION = "community.votes";
const CLICKS_COLLECTION = "community.clicks";
const NOTIFICATIONS_COLLECTION = "community.notifications";

const RETENTION_DAYS = 30;

let indexesReady = false;
let indexesPromise = null;

const INDEX_SPECS = [
  {
    collection: POSTS_COLLECTION,
    key: { post_id: 1 },
    options: { unique: true, name: "uniq_post_id" },
  },
  {
    collection: POSTS_COLLECTION,
    key: { image_id: 1 },
    options: { name: "by_image_id" },
  },
  {
    collection: POSTS_COLLECTION,
    key: { user_id: 1, created_at: -1 },
    options: { name: "by_user_created" },
  },
  {
    collection: POSTS_COLLECTION,
    key: { created_at: -1 },
    options: { name: "by_created_at" },
  },
  {
    collection: COMMENTS_COLLECTION,
    key: { comment_id: 1 },
    options: { unique: true, name: "uniq_comment_id" },
  },
  {
    collection: COMMENTS_COLLECTION,
    key: { post_id: 1, created_at: -1 },
    options: { name: "by_post_created" },
  },
  {
    collection: COMMENTS_COLLECTION,
    key: { user_id: 1, created_at: -1 },
    options: { name: "by_comment_user_created" },
  },
  {
    collection: VOTES_COLLECTION,
    key: { post_id: 1, user_id: 1 },
    options: { unique: true, name: "uniq_post_user_vote" },
  },
  {
    collection: CLICKS_COLLECTION,
    key: { post_id: 1, user_id: 1 },
    options: { unique: true, name: "uniq_post_user_click" },
  },
  {
    collection: CLICKS_COLLECTION,
    key: { clicked_at: 1 },
    options: { name: "by_clicked_at", expireAfterSeconds: 24 * 60 * 60 },
  },
  {
    collection: NOTIFICATIONS_COLLECTION,
    key: { recipient_user_id: 1, is_read: 1, last_event_at: -1 },
    options: { name: "notif_by_recipient_read" },
  },
  {
    collection: NOTIFICATIONS_COLLECTION,
    key: { recipient_user_id: 1, last_event_at: -1 },
    options: { name: "notif_by_recipient_latest" },
  },
  {
    collection: NOTIFICATIONS_COLLECTION,
    key: {
      recipient_user_id: 1,
      actor_user_id: 1,
      post_id: 1,
      type: 1,
      vote_value: 1,
      is_read: 1,
    },
    options: { name: "notif_collapse_key" },
  },
  {
    collection: NOTIFICATIONS_COLLECTION,
    key: { created_at: 1 },
    options: { name: "notif_ttl_created", expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 },
  },
];

function keyEntries(key) {
  return Object.entries(key);
}

function sameKeyPattern(leftKey, rightKey) {
  const leftEntries = keyEntries(leftKey);
  const rightEntries = keyEntries(rightKey);

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([field, direction], index) => {
    const [otherField, otherDirection] = rightEntries[index];
    return field === otherField && direction === otherDirection;
  });
}

function sameOptionalNumberOption(existing, desired, optionName) {
  const left = existing?.[optionName];
  const right = desired?.[optionName];
  if (left == null && right == null) {
    return true;
  }
  return Number(left) === Number(right);
}

function sameOptionalBooleanOption(existing, desired, optionName) {
  return Boolean(existing?.[optionName]) === Boolean(desired?.[optionName]);
}

function isEquivalentIndex(existingIndex, key, options) {
  return (
    sameKeyPattern(existingIndex.key || {}, key) &&
    sameOptionalBooleanOption(existingIndex, options, "unique") &&
    sameOptionalNumberOption(existingIndex, options, "expireAfterSeconds")
  );
}

function createIndexConflictError(collectionName, desiredName, existingName) {
  return new Error(
    `Index '${desiredName}' on ${collectionName} conflicts with existing incompatible index '${existingName}'`,
  );
}

async function readIndexes(collection) {
  try {
    return await collection.listIndexes().toArray();
  } catch (error) {
    if (error?.codeName === "NamespaceNotFound") {
      return [];
    }
    throw error;
  }
}

async function ensureIndex(collection, collectionName, key, options) {
  const indexes = await readIndexes(collection);
  const equivalent = indexes.find((index) => isEquivalentIndex(index, key, options));
  if (equivalent) {
    return equivalent.name;
  }

  const named = indexes.find((index) => index.name === options.name);
  if (named) {
    throw createIndexConflictError(collectionName, options.name, named.name);
  }

  try {
    return await collection.createIndex(key, options);
  } catch (error) {
    const refreshedIndexes = await readIndexes(collection);
    const refreshedEquivalent = refreshedIndexes.find((index) => isEquivalentIndex(index, key, options));
    if (refreshedEquivalent) {
      return refreshedEquivalent.name;
    }
    throw error;
  }
}

async function createCommunityIndexes(db) {
  const collections = new Map([
    [POSTS_COLLECTION, db.collection(POSTS_COLLECTION)],
    [COMMENTS_COLLECTION, db.collection(COMMENTS_COLLECTION)],
    [VOTES_COLLECTION, db.collection(VOTES_COLLECTION)],
    [CLICKS_COLLECTION, db.collection(CLICKS_COLLECTION)],
    [NOTIFICATIONS_COLLECTION, db.collection(NOTIFICATIONS_COLLECTION)],
  ]);

  await Promise.all(
    INDEX_SPECS.map(({ collection, key, options }) =>
      ensureIndex(collections.get(collection), collection, key, options),
    ),
  );
}

export async function ensureCommunityIndexes(db) {
  if (indexesReady) {
    return;
  }

  if (!indexesPromise) {
    indexesPromise = createCommunityIndexes(db)
      .then(() => {
        indexesReady = true;
      })
      .catch((error) => {
        indexesPromise = null;
        throw error;
      });
  }

  await indexesPromise;
}

export function resetCommunityIndexesForTests() {
  indexesReady = false;
  indexesPromise = null;
}
