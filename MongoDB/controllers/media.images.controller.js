const { v4: uuidv4 } = require('uuid');
const Image = require('../mongo-models/media.images.model');

/* -------------------------------------------------------------------------- */
/*                                CREATE IMAGE                                */
/* -------------------------------------------------------------------------- */

/**
 * POST /images
 * Scenario:
 *   Client uploads an image and you store its metadata (S3 key, etc.) in MongoDB.
 * Auth:
 *   Currently none enforced here (public), but can be extended later.
 * Input (body):
 *   {
 *     "s3_key": "path/in/s3/bucket/filename.jpg"
 *   }
 * Notes:
 *   Your schema currently requires user_id, is_ai, score, likelihood.
 *   This matches your original route behavior and only sets image_id + s3_key.
 *   You may extend this later to include more fields.
 * Output (201):
 *   Created image document:
 *   {
 *     "image_id": "UUID",
 *     "s3_key": "...",
 *     ...other schema fields (defaults)...
 *   }
 */
async function createImage(req, res) {
  try {
    // now also accept the required schema fields
    const {
      s3_key,
      user_id: bodyUserId,
      is_ai,
      score,
      likelihood,
      is_public,
    } = req.body || {};

    const user_id = bodyUserId || (req.user && req.user.user_id);

    if (
      !s3_key ||
      !user_id ||
      is_ai === undefined ||
      score === undefined ||
      likelihood === undefined
    ) {
      return res.status(400).json({
        error:
          'Missing required fields: user_id, s3_key, is_ai, score, likelihood',
      });
    }

    const record = new Image({
      image_id: uuidv4(),
      user_id,
      s3_key,
      is_ai,
      score,
      likelihood,
      ...(is_public !== undefined ? { is_public } : {}),
    });

    await record.save();
    return res.status(201).json(record);
  } catch (err) {
    console.error('create image error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* -------------------------------------------------------------------------- */
/*                                 LIST IMAGES                                */
/* -------------------------------------------------------------------------- */

/**
 * GET /images
 * Scenario:
 *   Client fetching a paginated-ish list of image records for admin/management UI.
 * Auth:
 *   None by default (can be locked down later).
 * Input:
 *   No params, no query (current behavior).
 * Output (200):
 *   {
 *     "items": [
 *       { "image_id": "...", "s3_key": "...", ... },
 *       ...
 *     ]
 *   }
 *   Ordered newest-first (by _id) and limited to 200 records.
 */
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

/* -------------------------------------------------------------------------- */
/*                                 GET IMAGE                                  */
/* -------------------------------------------------------------------------- */

/**
 * GET /images/:image_id
 * Scenario:
 *   Client fetching details of a single image record.
 * Auth:
 *   None enforced here.
 * Input (params):
 *   /images/IMAGE_UUID
 * Output (200):
 *   Full image document or 404 if not found.
 */
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

/* -------------------------------------------------------------------------- */
/*                                DELETE IMAGE                                */
/* -------------------------------------------------------------------------- */

/**
 * DELETE /images/:image_id
 * Scenario:
 *   Remove an image record from the database (metadata only, not S3 object).
 * Auth:
 *   None enforced here; for production you likely want this admin-only.
 * Input (params):
 *   /images/IMAGE_UUID
 * Output (200):
 *   {
 *     "deleted": true,
 *     "image": { ...deleted document... }
 *   }
 */
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
  deleteImage,
};