const { v4: uuidv4 } = require('uuid');
const Post = require('../mongo-models/community.posts.model');

/* -------------------------------------------------------------------------- */
/*                                CREATE POST                                 */
/* -------------------------------------------------------------------------- */

/**
 * POST /posts
 * Scenario:
 *   Logged-in user creates a community post tied to an uploaded image.
 * Auth:
 *   Requires req.user.user_id (set by JWT middleware).
 * Input (body):
 *   {
 *     "image_id": "IMAGE_UUID",
 *     "description": "What do you think this is?",
 *     "result": { ...optional detector snapshot... } | null
 *   }
 * Output (201):
 *   Created post document:
 *   {
 *     "post_id": "UUID",
 *     "user_id": "USER_UUID",
 *     "image_id": "IMAGE_UUID",
 *     "description": "...",
 *     "result": null | { ... },
 *     "up_vote_count": 0,
 *     "down_vote_count": 0,
 *     "clicks_count": 0,
 *     "created_at": "...",
 *     ...
 *   }
 */
async function createPost(req, res) {
  try {
    const authUser = req.user;
    if (!authUser || !authUser.user_id) {
      return res
        .status(401)
        .json({ error: 'Unauthorized: missing user context' });
    }

    const { image_id, description, result } = req.body || {};
    const user_id = authUser.user_id;

    if (!image_id || !description) {
      return res.status(400).json({
        error: 'Missing required fields (image_id, description)',
      });
    }

    const post = new Post({
      post_id: uuidv4(),
      user_id,
      image_id,
      description,
      result: result ?? null,
    });

    await post.save();
    return res.status(201).json(post);
  } catch (err) {
    console.error('create post error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* -------------------------------------------------------------------------- */
/*                                 LIST POSTS                                 */
/* -------------------------------------------------------------------------- */

/**
 * GET /posts
 * Scenario:
 *   Client fetching a feed of posts, optionally filtered by a single user.
 * Input (query):
 *   user_id=USER_UUID (optional)
 * Output (200):
 *   {
 *     "items": [
 *       {
 *         "post_id": "...",
 *         "user_id": "...",
 *         "image_id": "...",
 *         "description": "...",
 *         ...
 *       },
 *       ...
 *     ]
 *   }
 */
async function listPosts(req, res) {
  try {
    const { user_id } = req.query || {};
    const q = {};
    if (user_id) q.user_id = user_id;

    const items = await Post.find(q)
      .sort({ created_at: -1 })
      .limit(100)
      .exec();

    return res.status(200).json({ items });
  } catch (err) {
    console.error('list posts error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* -------------------------------------------------------------------------- */
/*                                  GET POST                                  */
/* -------------------------------------------------------------------------- */

/**
 * GET /posts/:post_id
 * Scenario:
 *   Client viewing details of a single post.
 * Input (params):
 *   /posts/POST_UUID
 * Output (200):
 *   Full post document or 404 if not found.
 */
async function getPost(req, res) {
  try {
    const { post_id } = req.params;
    const post = await Post.findOne({ post_id }).exec();
    if (!post) return res.status(404).json({ error: 'Post not found' });
    return res.status(200).json(post);
  } catch (err) {
    console.error('get post error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* -------------------------------------------------------------------------- */
/*                                  VOTE POST                                 */
/* -------------------------------------------------------------------------- */

/**
 * POST /posts/:post_id/vote
 * Scenario:
 *   Logged-in user upvotes or downvotes a post.
 * Auth:
 *   Requires req.user.user_id.
 * Input:
 *   params: post_id
 *   body: { "vote": "up" } or { "vote": "down" }
 * Notes:
 *   No per-user vote tracking yet; multiple votes are not prevented at DB level.
 * Output (200):
 *   Updated post document (with up_vote_count / down_vote_count incremented).
 */
async function votePost(req, res) {
  try {
    const authUser = req.user;
    if (!authUser || !authUser.user_id) {
      return res
        .status(401)
        .json({ error: 'Unauthorized: missing user context' });
    }

    const { post_id } = req.params;
    const { vote } = req.body || {};

    if (!vote || (vote !== 'up' && vote !== 'down')) {
      return res
        .status(400)
        .json({ error: "Invalid vote (must be 'up' or 'down')" });
    }

    const update =
      vote === 'up'
        ? { $inc: { up_vote_count: 1 } }
        : { $inc: { down_vote_count: 1 } };

    const post = await Post.findOneAndUpdate({ post_id }, update, {
      new: true,
    }).exec();

    if (!post) return res.status(404).json({ error: 'Post not found' });
    return res.status(200).json(post);
  } catch (err) {
    console.error('vote error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* -------------------------------------------------------------------------- */
/*                                 CLICK POST                                 */
/* -------------------------------------------------------------------------- */

/**
 * POST /posts/:post_id/click
 * Scenario:
 *   Track that some logged-in user clicked / opened the post.
 * Auth:
 *   Requires req.user.user_id.
 * Input (params):
 *   post_id
 * Output (200):
 *   Updated post document with clicks_count incremented by 1.
 */
async function clickPost(req, res) {
  try {
    const authUser = req.user;
    if (!authUser || !authUser.user_id) {
      return res
        .status(401)
        .json({ error: 'Unauthorized: missing user context' });
    }

    const { post_id } = req.params;

    const post = await Post.findOneAndUpdate(
      { post_id },
      { $inc: { clicks_count: 1 } },
      { new: true }
    ).exec();

    if (!post) return res.status(404).json({ error: 'Post not found' });
    return res.status(200).json(post);
  } catch (err) {
    console.error('click error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* -------------------------------------------------------------------------- */
/*                                UPDATE POST                                 */
/* -------------------------------------------------------------------------- */

/**
 * PATCH /posts/:post_id
 * Scenario:
 *   Post owner (or admin) edits the post description.
 * Auth:
 *   req.user must be set; user must be either:
 *     - the post’s user_id, or
 *     - an admin (is_admin === true).
 * Input:
 *   params: post_id
 *   body: { "description": "new description" }
 * Output (200):
 *   Updated post object, or:
 *     401 if not logged in,
 *     403 if not owner/admin,
 *     404 if post not found.
 */
async function updatePost(req, res) {
  try {
    const authUser = req.user;
    if (!authUser || !authUser.user_id) {
      return res
        .status(401)
        .json({ error: 'Unauthorized: missing user context' });
    }

    const { post_id } = req.params;
    const raw = req.body || {};

    // Block MongoDB operator injection
    if (Object.keys(raw).some((k) => k.startsWith('$'))) {
      return res.status(400).json({ error: 'Update operators not allowed' });
    }

    // Allowed fields
    const ALLOWED = ['description'];
    const safeUpdate = {};
    for (const key of ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        safeUpdate[key] = raw[key];
      }
    }

    // Fetch post to check ownership/admin rights
    const existing = await Post.findOne({ post_id }).exec();
    if (!existing) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Only owner or admin can update
    if (!authUser.is_admin && existing.user_id !== authUser.user_id) {
      return res.status(403).json({ error: 'Forbidden: not your post' });
    }

    // Update and return new version
    const post = await Post.findOneAndUpdate(
      { post_id },
      safeUpdate,
      { new: true }
    ).exec();

    return res.status(200).json(post);
  } catch (err) {
    console.error('update post error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* -------------------------------------------------------------------------- */
/*                                DELETE POST                                 */
/* -------------------------------------------------------------------------- */

/**
 * DELETE /posts/:post_id
 * Scenario:
 *   Post owner (or admin) deletes a post.
 * Auth:
 *   req.user must be set; user must be either:
 *     - the post’s user_id, or
 *     - an admin (is_admin === true).
 * Input (params):
 *   post_id
 * Output (200):
 *   {
 *     "deleted": true,
 *     "post": { "post_id": "...", ... }
 *   }
 */
async function deletePost(req, res) {
  try {
    const authUser = req.user;
    if (!authUser || !authUser.user_id) {
      return res
        .status(401)
        .json({ error: 'Unauthorized: missing user context' });
    }

    const { post_id } = req.params;

    // Fetch the post to check ownership/admin rights
    const existing = await Post.findOne({ post_id }).exec();
    if (!existing) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Only owner or admin can delete
    if (!authUser.is_admin && existing.user_id !== authUser.user_id) {
      return res.status(403).json({ error: 'Forbidden: not your post' });
    }

    // Perform deletion
    const deleted = await Post.findOneAndDelete({ post_id }).exec();

    return res.status(200).json({
      deleted: true,
      post: deleted,
    });
  } catch (err) {
    console.error('delete post error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createPost,
  listPosts,
  getPost,
  votePost,
  clickPost,
  updatePost,
  deletePost,
};