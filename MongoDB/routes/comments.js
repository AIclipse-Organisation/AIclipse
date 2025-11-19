const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const Comment = require('../mongo-models/Comment');
const User = require('../mongo-models/User');

// POST /comments - Add new comment to a post (body: { post_id, user_id, text })
router.post('/', async (req, res) => {
  try {
    const { post_id, user_id, text } = req.body || {};
    if (!post_id || !user_id || !text) return res.status(400).json({ error: 'Missing required fields' });
    const comment = new Comment({ comment_id: uuidv4(), post_id, user_id, text });
    await comment.save();
    return res.status(201).json(comment);
  } 
  catch (err) {
    console.error('create comment error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /comments - List comments (filter by ?post_id or ?user_name)
router.get('/', async (req, res) => {
  try {
    const { post_id, user_name } = req.query || {};
    const q = {};
    if (post_id) q.post_id = post_id;
    
    // If filtering by username, find user first and get their user_id
    if (user_name) {
      const user = await User.findOne({ user_name }).exec();
      if (!user) return res.status(200).json({ items: [] }); // No user found, return empty
      q.user_id = user.user_id;
    }
    
    const items = await Comment.find(q).sort({ created_at: -1 }).limit(500).exec();
    return res.status(200).json({ items });
  } 
  catch (err) {
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
  }
   catch (err) {
    console.error('get comment error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /comments/:comment_id - Update comment text (comment_id immutable) 
router.patch('/:comment_id', async (req, res) => {
  try {
    const { comment_id } = req.params;
    const raw = req.body || {};
    
    // Reject any update operator usage (prevent injection)
    if (Object.keys(raw).some(k => k.startsWith('$'))) {
      return res.status(400).json({ error: 'Update operators not allowed' });
    }
    
    // Whitelist allowed fields
    const ALLOWED = ['text'];
    const safeUpdate = {};
    for (const key of ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        safeUpdate[key] = raw[key];
      }
    }
    
    const entry = await Comment.findOneAndUpdate({ comment_id }, safeUpdate, { new: true }).exec();
    if (!entry) return res.status(404).json({ error: 'Comment not found' });
    return res.status(200).json(entry);
  }
  
  catch (err) {
    console.error('update comment error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /comments/:comment_id - Remove a comment
router.delete('/:comment_id', async (req, res) => {
  try {
    const { comment_id } = req.params;
    const entry = await Comment.findOneAndDelete({ comment_id }).exec();
    if (!entry) return res.status(404).json({ error: 'Comment not found' });
    return res.status(200).json({ deleted: true, comment: entry });
  }
   catch (err) {
    console.error('delete comment error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
