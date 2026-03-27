const { v4: uuidv4 } = require('uuid');
const Comment = require('../mongo-models/community.comments.model');

/* -------------------------------------------------------------------------- */
/*                               AUTH HELPER                                  */
/* -------------------------------------------------------------------------- */

/**
 * helper: get auth user or null
 * Scenario:
 *   Used by comment handlers to check if a logged-in user exists.
 * Needs:
 *   req.user set by JWT middleware upstream.
 * Effect:
 *   Returns the user object if it has a user_id; otherwise returns null.
 */
function getAuthUser(req) {
  const u = req.user;
  if (!u || !u.user_id) return null;
  return u;
}

/* -------------------------------------------------------------------------- */
/*                                CREATE COMMENT                              */
/* -------------------------------------------------------------------------- */

/**
 * POST /comments
 * Scenario:
 *   Logged-in user adding a new comment to a post (or a reply if parent_comment_id is set).
 * Auth:
 *   Requires valid req.user.user_id (set by JWT middleware).
 * Input (body):
 *   {
 *     "post_id": "POST_UUID",
 *     "text": "Comment text",
 *     "parent_comment_id": "OPTIONAL_PARENT_COMMENT_UUID | null"
 *   }
 * Output (201):
 *   Created comment document:
 *   {
 *     "comment_id": "UUID",
 *     "post_id": "POST_UUID",
 *     "parent_comment_id": null | "PARENT_COMMENT_UUID",
 *     "user_id": "USER_UUID",
 *     "text": "...",
 *     "created_at": "...",
 *     "up_vote_count": 0,
 *     "down_vote_count": 0,
 *     ...
 *   }
 */
async function createComment(req, res) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res
        .status(401)
        .json({ error: 'Unauthorized: missing user context' });
    }

    const { post_id, text, parent_comment_id = null } = req.body || {};
    const user_id = authUser.user_id;

    if (!post_id || !text) {
      return res
        .status(400)
        .json({ error: 'Missing required fields (post_id, text)' });
    }

    const comment = new Comment({
      comment_id: uuidv4(),
      post_id, // matches schema field
      parent_comment_id,
      user_id,
      text,
    });

    await comment.save();
    return res.status(201).json(comment);
  } catch (err) {
    console.error('create comment error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* -------------------------------------------------------------------------- */
/*                                 LIST COMMENTS                              */
/* -------------------------------------------------------------------------- */

/**
 * GET /comments
 * Scenario:
 *   Listing comments for a post or comments written by a specific user.
 * Input (query):
 *   post_id=POST_UUID   → comments under that post
 *   user_id=USER_UUID   → comments authored by that user
 *   (both may be provided to narrow further)
 * Output (200):
 *   {
 *     "items": [
 *       { "comment_id": "...", "post_id": "...", "user_id": "...", "text": "...", ... },
 *       ...
 *     ]
 *   }
 */
async function listComments(req, res) {
  try {
    const { post_id, user_id } = req.query || {};
    const q = {};
    if (post_id) q.post_id = post_id;
    if (user_id) q.user_id = user_id;

    const items = await Comment.find(q)
      .sort({ created_at: -1 })
      .limit(500)
      .exec();

    return res.status(200).json({ items });
  } catch (err) {
    console.error('list comments error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* -------------------------------------------------------------------------- */
/*                                GET COMMENT                                 */
/* -------------------------------------------------------------------------- */

/**
 * GET /comments/:comment_id
 * Scenario:
 *   Fetch details of a single comment.
 * Input (params):
 *   /comments/COMMENT_UUID
 * Output (200):
 *   Full comment object or 404 if not found.
 */
async function getComment(req, res) {
  try {
    const { comment_id } = req.params;
    const entry = await Comment.findOne({ comment_id }).exec();
    if (!entry) return res.status(404).json({ error: 'Comment not found' });
    return res.status(200).json(entry);
  } catch (err) {
    console.error('get comment error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* -------------------------------------------------------------------------- */
/*                               UPDATE COMMENT                               */
/* -------------------------------------------------------------------------- */

/**
 * PATCH /comments/:comment_id
 * Scenario:
 *   Comment author (or admin) edits the comment text.
 * Auth:
 *   - req.user must be set (JWT)
 *   - user must be either:
 *    the comment’s user_id, OR
 *    an admin (req.user.is_admin === true)
 * Input (params):
 *   comment_id
 * Input (body):
 *   { "text": "new text" }
 * Output (200):
 *   Updated comment object, or:
 *     401 if not logged in,
 *     403 if not the owner or admin,
 *     404 if comment not found.
 */
async function updateComment(req, res) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res
        .status(401)
        .json({ error: 'Unauthorized: missing user context' });
    }

    const { comment_id } = req.params;
    const raw = req.body || {};

    // Prevent MongoDB update operators
    if (Object.keys(raw).some((k) => k.startsWith('$'))) {
      return res.status(400).json({ error: 'Update operators not allowed' });
    }

    const ALLOWED = ['text'];
    const safeUpdate = {};
    for (const key of ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        safeUpdate[key] = raw[key];
      }
    }

    const existing = await Comment.findOne({ comment_id }).exec();
    if (!existing) return res.status(404).json({ error: 'Comment not found' });

    // Only the author or an admin can edit
    if (!authUser.is_admin && existing.user_id !== authUser.user_id) {
      return res.status(403).json({ error: 'Forbidden: not your comment' });
    }

    const entry = await Comment.findOneAndUpdate(
      { comment_id },
      safeUpdate,
      { new: true }
    ).exec();

    return res.status(200).json(entry);
  } catch (err) {
    console.error('update comment error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* -------------------------------------------------------------------------- */
/*                               DELETE COMMENT                               */
/* -------------------------------------------------------------------------- */

/**
 * DELETE /comments/:comment_id
 * Scenario:
 *   Comment author or admin deletes a comment.
 * Auth:
 *   Same rules as PATCH:
 *     - must be logged in
 *     - must be original author or admin
 * Input (params):
 *   comment_id
 * Output (200):
 *   {
 *     "deleted": true,
 *     "comment": { ...deleted comment doc... }
 *   }
 * or:
 *   401 if not logged in,
 *   403 if not authorized,
 *   404 if comment not found.
 */
async function deleteComment(req, res) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res
        .status(401)
        .json({ error: 'Unauthorized: missing user context' });
    }

    const { comment_id } = req.params;
    const existing = await Comment.findOne({ comment_id }).exec();
    if (!existing) return res.status(404).json({ error: 'Comment not found' });

    if (!authUser.is_admin && existing.user_id !== authUser.user_id) {
      return res.status(403).json({ error: 'Forbidden: not your comment' });
    }

    const entry = await Comment.findOneAndDelete({ comment_id }).exec();
    return res.status(200).json({ deleted: true, comment: entry });
  } catch (err) {
    console.error('delete comment error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createComment,
  listComments,
  getComment,
  updateComment,
  deleteComment,
};