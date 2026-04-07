function buildRollbackUpdate(previousPost, fields) {
  const rollbackSet = {};
  const rollbackUnset = {};

  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(previousPost, field)) {
      rollbackSet[field] = previousPost[field];
    } else {
      rollbackUnset[field] = "";
    }
  }

  const update = {};
  if (Object.keys(rollbackSet).length > 0) {
    update.$set = rollbackSet;
  }
  if (Object.keys(rollbackUnset).length > 0) {
    update.$unset = rollbackUnset;
  }
  return update;
}

export async function createPostWithImageSyncOrRollback({
  postsCol,
  postDoc,
  syncImage,
}) {
  await postsCol.insertOne(postDoc);
  try {
    await syncImage();
  } catch (error) {
    try {
      await postsCol.deleteOne({ post_id: postDoc.post_id });
    } catch (rollbackErr) {
      console.error("Failed to roll back post after image sync failure:", rollbackErr);
    }
    throw error;
  }
}

export async function updatePostStateWithImageSyncOrRollback({
  postsCol,
  previousPost,
  nextState,
  rollbackFields,
  syncImage,
}) {
  await postsCol.updateOne(
    { post_id: previousPost.post_id },
    { $set: nextState },
  );

  try {
    await syncImage();
  } catch (error) {
    const rollbackUpdate = buildRollbackUpdate(previousPost, rollbackFields);
    try {
      await postsCol.updateOne({ post_id: previousPost.post_id }, rollbackUpdate);
    } catch (rollbackErr) {
      console.error("Failed to roll back post state after image sync failure:", rollbackErr);
    }
    throw error;
  }
}
