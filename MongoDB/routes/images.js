const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const Image = require('../mongo-models/Image');

// POST /images - Store new image and data in database
router.post('/', async (req, res) => {
  try {
    const data = req.body || {};
    if (!data.s3_key) return res.status(400).json({ error: 'Missing s3_key' });
    const record = new Image(Object.assign({}, data, { image_id: uuidv4() }));
    await record.save();
    return res.status(201).json(record);
  } 
  catch (err) {
    console.error('create image error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /images - List image records with optional filters
router.get('/', async (req, res) => {
  try {
    const q = req.query || {};
    const items = await Image.find(q).sort({ uploaded_at: -1 }).limit(200).exec();
    return res.status(200).json({ items });
  } 
  catch (err) {
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
  }
   catch (err) {
    console.error('get image error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /images/:image_id - Update image fields (image_id immutable, flags editable)
router.patch('/:image_id', async (req, res) => {
  try {
    const { image_id } = req.params;
    const raw = req.body || {};
    
    // Reject any update operator usage (prevent injection)
    if (Object.keys(raw).some(k => k.startsWith('$'))) {
      return res.status(400).json({ error: 'Update operators not allowed' });
    }
    
    // Whitelist allowed fields for update
    const ALLOWED = ['is_ai', 'likelihood', 'is_public', 'is_reported'];
    const safeUpdate = {};
    for (const key of ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        safeUpdate[key] = raw[key];
      }
    }
    
    const entry = await Image.findOneAndUpdate({ image_id }, safeUpdate, { new: true }).exec();
    if (!entry) return res.status(404).json({ error: 'Image not found' });
    return res.status(200).json(entry);
  } 
  catch (err) {
    console.error('update image error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /images/:image_id - Remove image record
router.delete('/:image_id', async (req, res) => {
  try {
    const { image_id } = req.params;
    const entry = await Image.findOneAndDelete({ image_id }).exec();
    if (!entry) return res.status(404).json({ error: 'Image not found' });
    return res.status(200).json({ deleted: true, image: entry });
  } 
  catch (err) {
    console.error('delete image error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
