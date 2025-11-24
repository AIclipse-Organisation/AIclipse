// controllers/media.images.controller.js
const { v4: uuidv4 } = require('uuid');
const Image = require('../mongo-models/media.images.model');

// POST /images
async function createImage(req, res) {
  try {
    const { s3_key } = req.body || {};

    if (!s3_key) {
      return res.status(400).json({ error: 'Missing required field: s3_key' });
    }

    // NOTE: your schema currently requires user_id, is_ai, score, likelihood.
    // This controller keeps the same behavior as your existing route, so you
    // may want to extend this later to include those fields.
    const record = new Image({
      image_id: uuidv4(),
      s3_key,
    });

    await record.save();
    return res.status(201).json(record);
  } catch (err) {
    console.error('create image error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /images
async function listImages(req, res) {
  try {
    const items = await Image.find({})
      .sort({ _id: -1 })
      .limit(200)
      .exec();

    return res.status(200).json({ items });
  } catch (err) {
    console.error('list images error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /images/:image_id
async function getImage(req, res) {
  try {
    const { image_id } = req.params;
    const entry = await Image.findOne({ image_id }).exec();
    if (!entry) return res.status(404).json({ error: 'Image not found' });
    return res.status(200).json(entry);
  } catch (err) {
    console.error('get image error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PATCH /images/:image_id
async function updateImage(req, res) {
  try {
    const { image_id } = req.params;
    const raw = req.body || {};

    if (Object.keys(raw).some((k) => k.startsWith('$'))) {
      return res.status(400).json({ error: 'Update operators not allowed' });
    }

    const ALLOWED = ['s3_key'];
    const safeUpdate = {};
    for (const key of ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        safeUpdate[key] = raw[key];
      }
    }

    const entry = await Image.findOneAndUpdate(
      { image_id },
      safeUpdate,
      { new: true }
    ).exec();

    if (!entry) return res.status(404).json({ error: 'Image not found' });
    return res.status(200).json(entry);
  } catch (err) {
    console.error('update image error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// DELETE /images/:image_id
async function deleteImage(req, res) {
  try {
    const { image_id } = req.params;
    const entry = await Image.findOneAndDelete({ image_id }).exec();
    if (!entry) return res.status(404).json({ error: 'Image not found' });
    return res.status(200).json({ deleted: true, image: entry });
  } catch (err) {
    console.error('delete image error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createImage,
  listImages,
  getImage,
  updateImage,
  deleteImage,
};
