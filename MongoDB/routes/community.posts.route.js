const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const Post = require('../mongo-models/community.posts.model');

// POST /posts - Create a new post with image and detection result
// Scenario: Logged-in user creates a community post tied to an uploaded image.
// Auth: Requires req.user.user_id.
// Input (body):{ "image_id": "IMAGE_UUID", "description": "What do you think this is?", "result":}
// Output (201): created post object.
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
// Scenario: Client fetching a feed of posts, optionally for a single user.
// Input (query): Optional ?user_id=USER_UUID
// Output (200):{"items": [ { "post_id": "...", "user_id": "...", "image_id": "...", "description": "..."]}
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
//Scenario: Client viewing details of a single post.
//Input (params): /posts/POST_UUID
//Output (200): The full post document.

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
// Scenario: Logged-in user upvotes or downvotes a post.
// Auth: Requires req.user.user_id.
// Input (params): post_id , { "vote": "up" } or { "vote": "down" }
// Notes: Right now there’s no per-user vote tracking, so client-side or future logic must prevent multiple votes.

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

    const update =vote === 'up'? { $inc: { up_vote_count: 1 } }: { $inc: { down_vote_count: 1 } }; // will need to ensure user can't vote multiple times

    const post = await Post.findOneAndUpdate({ post_id }, update, { new: true }).exec();
    if (!post) return res.status(404).json({ error: 'Post not found' });
    return res.status(200).json(post);
  } catch (err) {
    console.error('vote error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /posts/:post_id/click - Track engagement
// Scenario: Track that some logged-in user clicked / opened the post.
// Auth: Requires req.user.user_id.
// Input (params): post_id
// Output (200): Post document with clicks_count incremented by 1.

router.post('/:post_id/click', async (req, res) => {
  try {
    const authUser = req.user;
    if (!authUser || !authUser.user_id) {
      return res.status(401).json({ error: 'Unauthorized: missing user context' });
    }

    const { post_id } = req.params;
    // increment clicks_count by 1 for the post if a user clicks on it 
    const post = await Post.findOneAndUpdate({ post_id }, { $inc: { clicks_count: 1 } },{ new: true }).exec();
  
    if (!post) return res.status(404).json({ error: 'Post not found' });
    return res.status(200).json(post);
  }
   catch (err) {
    console.error('click error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /posts/:post_id - Update post fields
// Scenario: Post owner (or admin) edits the post description.
// Auth: req.user must be set; user must be either: the post’s user_id, or an admin (is_admin === true).
// Input (params): post_id , body { description: "new description" }
// Output (200): updated post object.
router.patch('/:post_id', async (req, res) => {
  try {
    const authUser = req.user;
    if (!authUser || !authUser.user_id) {
      return res.status(401).json({ error: 'Unauthorized: missing user context' });
    }

    const { post_id } = req.params;
    const raw = req.body || {};

    // Block MongoDB operator injection
    if (Object.keys(raw).some(k => k.startsWith('$'))) {
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

    // Fetch post to check ownership
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
});


// DELETE /posts/:post_id - Permanently remove a post
// Scenario: Post owner (or admin) deletes a post.
// Auth: req.user must be set; user must be either: the post’s user_id, or an admin (is_admin === true).
// Input (params): post_id
// Output (200): { deleted: true, post: { post_id: "...", ... } }
router.delete('/:post_id', async (req, res) => {
  try {
    const authUser = req.user;
    if (!authUser || !authUser.user_id) {
      return res.status(401).json({ error: 'Unauthorized: missing user context' });
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
      post: deleted
    });

  } catch (err) {
    console.error('delete post error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


module.exports = router;



// CRUD , requests what they do , how their called , what they return , list all routs , client want command to return all users comments/images