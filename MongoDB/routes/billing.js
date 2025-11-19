const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const Billing = require('../mongo-models/Billing');
const User = require('../mongo-models/User');

// POST /billing - Record new billing transaction
router.post('/', async (req, res) => {
  try {
    const data = req.body || {};
    const record = new Billing(Object.assign({}, data, { billing_id: uuidv4() }));
    await record.save();
    return res.status(201).json(record);
  }
   catch (err) {
    console.error('create billing error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /billing - List all billing records with username filter (sorted by newest first)
router.get('/', async (req, res) => {
  try {
    const { user_name } = req.query || {};
    let q = {};
    
    // If filtering by username, find user first and get their user_id
    if (user_name) {
      const user = await User.findOne({ user_name }).exec();
      if (!user) return res.status(200).json({ items: [] }); // No user found, return empty
      q.user_id = user.user_id;
    }
    
    const items = await Billing.find(q).sort({ created_at: -1 }).limit(200).exec();
    return res.status(200).json({ items });
  }
   catch (err) {
    console.error('list billing error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /billing/:billing_id - Fetch specific billing record
router.get('/:billing_id', async (req, res) => {
  try {
    const { billing_id } = req.params;
    const entry = await Billing.findOne({ billing_id }).exec();
    if (!entry) return res.status(404).json({ error: 'Billing record not found' });
    return res.status(200).json(entry);
  }
   catch (err) {
    console.error('get billing error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /billing/:billing_id - Update billing fields (all core fields immutable: plan, status, amount, dates, billing_id, user_id, created_at)
router.patch('/:billing_id', async (req, res) => {
  try {
    const { billing_id } = req.params;
    const raw = req.body || {};
    
    // Reject any update operator usage (prevent injection)
    if (Object.keys(raw).some(k => k.startsWith('$'))) {
      return res.status(400).json({ error: 'Update operators not allowed' });
    }
    
    // Whitelist allowed fields (only editable fields; all core billing fields are immutable)
    const ALLOWED = [];
    const safeUpdate = {};
    for (const key of ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        safeUpdate[key] = raw[key];
      }
    }
    
    // If no allowed fields to update, reject the request
    if (Object.keys(safeUpdate).length === 0) {
      return res.status(400).json({ error: 'No editable fields provided' });
    }
    
    const entry = await Billing.findOneAndUpdate({ billing_id }, safeUpdate, { new: true }).exec();
    if (!entry) return res.status(404).json({ error: 'Billing record not found' });
    return res.status(200).json(entry);
  }
   catch (err) {
    console.error('update billing error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// we cant delete billing records for compliance reasons , we only change the status to cancelled or refunded


module.exports = router;
