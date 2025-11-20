const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const Comment = require('../mongo-models/community.comments.model');

// helper: must be logged in
function requireUser(req) {
  const u = req.user;
  if (!u || !u.user_id) {
    return null;
  }
  return u;
}

// POST /comments - Add new comment to a post
router.post('/', async (req, res) => {
  try {
    const authUser = requireUser(req);
    if (!authUser) {
      return res.status(401).json({ error: 'Unauthorized: missing user context' });
    }

    const { post_id, text } = req.body || {};
    const user_id = authUser.user_id;

    if (!post_id || !text) {
      return res.status(400).json({ error: 'Missing required fields (post_id, text)' });
    }

    const comment = new Comment({
      comment_id: uuidv4(),
      post_id,
      user_id,
      text,
    });

    await comment.save();
    return res.status(201).json(comment);
  } catch (err) {
    console.error('create comment error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /comments - List comments (filter by ?post_id or ?user_id)
router.get('/', async (req, res) => {
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
});

// GET /comments/:comment_id - Fetch a single comment
router.get('/:comment_id', async (req, res) => {
  try {
    const { comment_id } = req.params;
    const entry = await Comment.findOne({ comment_id }).exec();
    if (!entry) return res.status(404).json({ error: 'Comment not found' });
    return res.status(200).json(entry);
  } catch (err) {
    console.error('get comment error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /comments/:comment_id - Update comment text (author or admin only)
router.patch('/:comment_id', async (req, res) => {
  try {
    const authUser = requireUser(req);
    if (!authUser) {
      return res.status(401).json({ error: 'Unauthorized: missing user context' });
    }

    const { comment_id } = req.params;
    const raw = req.body || {};

    if (Object.keys(raw).some(k => k.startsWith('$'))) {
      return res.status(400).json({ error: 'Update operators not allowed' });
    }

    const ALLOWED = ['text'];
    const safeUpdate = {};
    for (const key of ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        safeUpdate[key] = raw[key];
      }
    }

    // load comment to check ownership
    const existing = await Comment.findOne({ comment_id }).exec();
    if (!existing) return res.status(404).json({ error: 'Comment not found' });

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
});

// DELETE /comments/:comment_id - Remove a comment (author or admin only)
router.delete('/:comment_id', async (req, res) => {
  try {
    const authUser = requireUser(req);
    if (!authUser) {
      return res.status(401).json({ error: 'Unauthorized: missing user context' });
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
});

module.exports = router;
