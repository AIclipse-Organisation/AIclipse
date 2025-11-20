const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const Post = require('../mongo-models/community.posts.model');

// POST /posts - Create a new post with image and detection result
router.post('/', async (req, res) => {
  try {
    // Gateway must have set req.user from the JWT
    const authUser = req.user;
    if (!authUser || !authUser.user_id) {
      return res.status(401).json({ error: 'Unauthorized: missing user context' });
    }

    const { image_id, description, result } = req.body || {};
    const user_id = authUser.user_id;

    if (!image_id || !description) {
      return res.status(400).json({ error: 'Missing required fields (image_id, description)' });
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
});

// GET /posts - List posts (can still filter by ?user_id for now,
// but in real SOA Gateway should decide what the caller can see)
router.get('/', async (req, res) => {
  try {
    const { user_id } = req.query || {};
    const q = {};
    if (user_id) q.user_id = user_id;
    const items = await Post.find(q).sort({ created_at: -1 }).limit(100).exec();
    return res.status(200).json({ items });
  } catch (err) {
    console.error('list posts error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /posts/:post_id - Fetch a single post
router.get('/:post_id', async (req, res) => {
  try {
    const { post_id } = req.params;
    const post = await Post.findOne({ post_id }).exec();
    if (!post) return res.status(404).json({ error: 'Post not found' });
    return res.status(200).json(post);
  } catch (err) {
    console.error('get post error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /posts/:post_id/vote - Increment up/down vote count
// NOTE: Gateway must ensure req.user is present (authenticated).
router.post('/:post_id/vote', async (req, res) => {
  try {
    const authUser = req.user;
    if (!authUser || !authUser.user_id) {
      return res.status(401).json({ error: 'Unauthorized: missing user context' });
    }

    const { post_id } = req.params;
    const { vote } = req.body || {};
    if (!vote || (vote !== 'up' && vote !== 'down')) {
      return res.status(400).json({ error: "Invalid vote (must be 'up' or 'down')" });
    }

    // TODO: enforce one vote per user per post at the schema/logic level.
    const update =
      vote === 'up'
        ? { $inc: { up_vote_count: 1 } }
        : { $inc: { down_vote_count: 1 } };

    const post = await Post.findOneAndUpdate({ post_id }, update, { new: true }).exec();
    if (!post) return res.status(404).json({ error: 'Post not found' });
    return res.status(200).json(post);
  } catch (err) {
    console.error('vote error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /posts/:post_id/click - Track engagement
router.post('/:post_id/click', async (req, res) => {
  try {
    const authUser = req.user;
    if (!authUser || !authUser.user_id) {
      return res.status(401).json({ error: 'Unauthorized: missing user context' });
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
});

// PATCH /posts/:post_id - Update post fields
router.patch('/:post_id', async (req, res) => {
  try {
    const authUser = req.user;
    if (!authUser || !authUser.user_id) {
      return res.status(401).json({ error: 'Unauthorized: missing user context' });
    }

    const { post_id } = req.params;
    const raw = req.body || {};

    if (Object.keys(raw).some(k => k.startsWith('$'))) {
      return res.status(400).json({ error: 'Update operators not allowed' });
    }

    const ALLOWED = ['description', 'result', 'controversial_since'];
    const safeUpdate = {};
    for (const key of ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        safeUpdate[key] = raw[key];
      }
    }

    const post = await Post.findOneAndUpdate({ post_id }, safeUpdate, { new: true }).exec();
    if (!post) return res.status(404).json({ error: 'Post not found' });
    return res.status(200).json(post);
  } catch (err) {
    console.error('update post error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /posts/:post_id - Permanently remove a post
router.delete('/:post_id', async (req, res) => {
  try {
    const authUser = req.user;
    if (!authUser || !authUser.user_id) {
      return res.status(401).json({ error: 'Unauthorized: missing user context' });
    }

    const { post_id } = req.params;
    const post = await Post.findOneAndDelete({ post_id }).exec();
    if (!post) return res.status(404).json({ error: 'Post not found' });
    return res.status(200).json({ deleted: true, post });
  } catch (err) {
    console.error('delete post error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
