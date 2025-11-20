const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const Image = require('../mongo-models/media.images.model');

// POST /images - Store new image and data in database
router.post('/', async (req, res) => {
  try {
    // user_id MUST come from Gateway-authenticated context
    const authUser = req.user;
    if (!authUser || !authUser.user_id) {
      return res.status(401).json({ error: 'Unauthorized: missing user context' });
    }

    const { s3_key, is_ai, likelihood, is_public } = req.body || {};
    const user_id = authUser.user_id;

    if (!s3_key) {
      return res.status(400).json({ error: 'Missing required field: s3_key' });
    }

    const record = new Image({
      image_id: uuidv4(),
      user_id,
      s3_key,
      is_ai: !!is_ai,
      likelihood: likelihood ?? null,
      is_public: !!is_public,
    });

    await record.save();
    return res.status(201).json(record);
  } catch (err) {
    console.error('create image error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /images - List image records
// For now: if ?user_id is provided → that user's images (admin/Gateway use);
// otherwise → only public images.
router.get('/', async (req, res) => {
  try {
    const { user_id } = req.query || {};
    const q = {};

    if (user_id) {
      q.user_id = user_id;
    } else {
      q.is_public = true;
    }

    const items = await Image.find(q).sort({ uploaded_at: -1 }).limit(200).exec();
    return res.status(200).json({ items });
  } catch (err) {
    console.error('list images error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /images/:image_id - Fetch image and detection result
router.get('/:image_id', async (req, res) => {
  try {
    const { image_id } = req.params;
    const entry = await Image.findOne({ image_id }).exec();
    if (!entry) return res.status(404).json({ error: 'Image not found' });
    return res.status(200).json(entry);
  } catch (err) {
    console.error('get image error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /images/:image_id - Update image flags
router.patch('/:image_id', async (req, res) => {
  try {
    const authUser = req.user;
    if (!authUser || !authUser.user_id) {
      return res.status(401).json({ error: 'Unauthorized: missing user context' });
    }

    const { image_id } = req.params;
    const raw = req.body || {};

    if (Object.keys(raw).some(k => k.startsWith('$'))) {
      return res.status(400).json({ error: 'Update operators not allowed' });
    }

    const ALLOWED = ['is_ai', 'likelihood', 'is_public', 'is_reported'];
    const safeUpdate = {};
    for (const key of ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        safeUpdate[key] = raw[key];
      }
    }

    const entry = await Image.findOneAndUpdate({ image_id }, safeUpdate, {
      new: true,
    }).exec();
    if (!entry) return res.status(404).json({ error: 'Image not found' });
    return res.status(200).json(entry);
  } catch (err) {
    console.error('update image error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /images/:image_id - Remove image record
router.delete('/:image_id', async (req, res) => {
  try {
    const authUser = req.user;
    if (!authUser || !authUser.user_id) {
      return res.status(401).json({ error: 'Unauthorized: missing user context' });
    }

    const { image_id } = req.params;
    const entry = await Image.findOneAndDelete({ image_id }).exec();
    if (!entry) return res.status(404).json({ error: 'Image not found' });
    return res.status(200).json({ deleted: true, image: entry });
  } catch (err) {
    console.error('delete image error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
