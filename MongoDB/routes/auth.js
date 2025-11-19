const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const User = require('../mongo-models/User');
const Post = require('../mongo-models/Post');
const Log = require('../mongo-models/Log');

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_SECRET';

// POST /auth/signup - Register new user account
router.post('/signup', async (req, res) => {
  try {
    const { user_name, email, password } = req.body || {};
    if (!user_name || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // check existing user
    const existing = await User.findOne({ email: email.trim().toLowerCase() }).exec();
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);

    const user = new User({
      user_id: uuidv4(),
      user_name: user_name.trim(),
      email: email.trim().toLowerCase(),
      password: hashed,
    });

    await user.save();

    const out = {
      user_id: user.user_id,
      user_name: user.user_name,
      email: user.email,
      is_admin: user.is_admin || false,
      plan: user.plan || 0,
      created_at: user.created_at,
    };

    return res.status(201).json(out);
  }
   catch (err) 
   {
    console.error('signup error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/login - Authenticate user and issue JWT
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

    const user = await User.findOne({ email: email.trim().toLowerCase() }).exec();
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const payload = { user_id: user.user_id, email: user.email, is_admin: user.is_admin };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });

    const outUser = {
      user_id: user.user_id,
      user_name: user.user_name,
      email: user.email,
      is_admin: user.is_admin,
      plan: user.plan,
    };

    return res.status(200).json({ token, user: outUser });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /auth - List all users (sorted by newest first or filter by ?user_name)
router.get('/', async (req, res) => {
  try {
    const { user_name } = req.query || {};
    const q = {};
    if (user_name) {
      q.user_name = { $regex: user_name, $options: 'i' };
    }
    const items = await User.find(q).sort({ created_at: -1 }).limit(200).select('-password -__v -_id').exec();
    return res.status(200).json({ items });
  } 
  catch (err) {
    console.error('list users error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /auth/:user_name - Retrieve specific user profile by username (password excluded)
router.get('/:user_name', async (req, res) => {
  try {
    const { user_name } = req.params;
    const user = await User.findOne({ user_name }).select('-password -__v -_id').exec();
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json(user);
  }
  
  catch (err) {
    console.error('get user error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /auth/:user_id - Update user fields (user_id immutable, password auto-hashed)
router.patch('/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    const raw = req.body || {};
    
    // Reject any update operator usage (prevent injection)
    if (Object.keys(raw).some(k => k.startsWith('$'))) {
      return res.status(400).json({ error: 'Update operators not allowed' });
    }
    
    // Whitelist allowed fields
    const ALLOWED = ['user_name', 'email', 'password', 'plan', 'Age', 'is_blacklisted'];
    const safeUpdate = {};
    for (const key of ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        safeUpdate[key] = raw[key];
      }
    }
    
    // Hash password if provided
    if (safeUpdate.password) {
      safeUpdate.password = await bcrypt.hash(safeUpdate.password, 10);
    }
    
    // Normalize email
    if (safeUpdate.email) {
      safeUpdate.email = safeUpdate.email.trim().toLowerCase();
    }
    
    const user = await User.findOneAndUpdate({ user_id }, safeUpdate, { new: true }).select('-password -__v -_id').exec();
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json(user);
  }
   catch (err) {
    console.error('update user error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

// DELETE /auth/:user_id - Remove user (doesnt delete related posts/logs for security purposes)
router.delete('/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    const user = await User.findOneAndDelete({ user_id }).exec();
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.status(200).json({ deleted: true, user: { user_id: user.user_id, email: user.email } });
  } catch (err) {
    console.error('delete user error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
