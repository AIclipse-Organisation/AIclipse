const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const Log = require('../mongo-models/Log');

// POST /logs - Create a log entry for audit/tracking (user action on posts/images)
router.post('/', async (req, res) => {
  try {
    const { user_id, action, image_id } = req.body || {};
    if (!user_id || !action) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const entry = new Log({
      log_id: uuidv4(),
      user_id,
      action,
      image_id: image_id || null,
    });

    await entry.save();
    return res.status(201).json(entry);
  } 
  catch (err) {
    console.error('create log error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /logs - List audit logs (can filter by ?user_id or ?image_id)
router.get('/', async (req, res) => {
  try {
    const { user_id, image_id } = req.query || {};
    const q = {};
    if (user_id) q.user_id = user_id;
    if (image_id) q.image_id = image_id;
    const items = await Log.find(q).sort({ created_at: -1 }).limit(500).exec();
    return res.status(200).json({ items });
  } 
  catch (err) {
    console.error('list logs error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /logs/:log_id - Fetch specific audit log entry
router.get('/:log_id', async (req, res) => {
  try {
    const { log_id } = req.params;
    const entry = await Log.findOne({ log_id }).exec();
    if (!entry) return res.status(404).json({ error: 'Log not found' });
    return res.status(200).json(entry);
  }
   catch (err) {
    console.error('get log error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

//do not allow updates or delets to logs for integrity reasons

module.exports = router;
