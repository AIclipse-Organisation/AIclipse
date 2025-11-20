const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const User = require('../mongo-models/auth.users.model');

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_SECRET';


function requireUser(req, res, next) {
  const u = req.user;
  if (!u || !u.user_id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function requireAdmin(req, res, next) {
  const u = req.user;
  if (!u || !u.is_admin) {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
}


/* ------------------------------ PUBLIC ROUTES ------------------------------ */

// POST /auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { user_name, email, password } = req.body || {};
    if (!user_name || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

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

    return res.status(201).json({
      user_id: user.user_id,
      user_name: user.user_name,
      email: user.email,
      is_admin: false,
      plan: 0,
      created_at: user.created_at,
    });
  } catch (err) {
    console.error('signup error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

    const user = await User.findOne({ email: email.trim().toLowerCase() }).exec();
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { user_id: user.user_id, email: user.email, is_admin: user.is_admin },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    return res.status(200).json({
      token,
      user: {
        user_id: user.user_id,
        user_name: user.user_name,
        email: user.email,
        is_admin: user.is_admin,
        plan: user.plan,
      },
    });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ------------------------------ GETTING YOUR INFO ------------------------------ */

// GET /auth/me
router.get('/me', requireUser, async (req, res) => {
  try {
    const { user_id } = req.user;

    const user = await User.findOne({ user_id })
      .select('-password -__v -_id')
      .exec();

    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.status(200).json(user);
  } catch (err) {
    console.error('get me error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /auth/me - user updates own profile
router.patch('/me', requireUser, async (req, res) => {
  try {
    const { user_id } = req.user;
    const raw = req.body || {};

    if (Object.keys(raw).some(k => k.startsWith('$'))) {
      return res.status(400).json({ error: 'Update operators not allowed' });
    }

    const ALLOWED = ['user_name', 'email', 'password', 'age'];
    const safeUpdate = {};

    for (const key of ALLOWED) {
      if (raw[key] !== undefined) safeUpdate[key] = raw[key];
    }

    if (safeUpdate.password) {
      safeUpdate.password = await bcrypt.hash(safeUpdate.password, 10);
    }

    if (safeUpdate.email) {
      safeUpdate.email = safeUpdate.email.trim().toLowerCase();
    }

    const updated = await User.findOneAndUpdate({ user_id }, safeUpdate, {
      new: true,
    })
      .select('-password -__v -_id')
      .exec();

    if (!updated) return res.status(404).json({ error: 'User not found' });

    return res.status(200).json(updated);
  } catch (err) {
    console.error('update me error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ------------------------------ ADMIN ROUTES ------------------------------ */

// GET /auth/admin/users
router.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const { user_name } = req.query || {};
    const q = {};

    if (user_name) q.user_name = { $regex: user_name, $options: 'i' };

    const items = await User.find(q)
      .sort({ created_at: -1 })
      .select('-password -__v -_id')
      .limit(200)
      .exec();

    return res.status(200).json({ items });
  } catch (err) {
    console.error('admin list users error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /auth/admin/user/:user_id
router.get('/admin/user/:user_id', requireAdmin, async (req, res) => {
  try {
    const { user_id } = req.params;

    const user = await User.findOne({ user_id })
      .select('-password -__v -_id')
      .exec();

    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.status(200).json(user);
  } catch (err) {
    console.error('admin get user error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /auth/admin/user/:user_id
router.patch('/admin/user/:user_id', requireAdmin, async (req, res) => {
  try {
    const { user_id } = req.params;
    const raw = req.body || {};

    if (Object.keys(raw).some(k => k.startsWith('$'))) {
      return res.status(400).json({ error: 'Update operators not allowed' });
    }

    const ALLOWED = ['user_name', 'email', 'password', 'plan', 'age', 'is_blacklisted', 'is_admin'];
    const safeUpdate = {};

    for (const key of ALLOWED) {
      if (raw[key] !== undefined) safeUpdate[key] = raw[key];
    }

    if (safeUpdate.password) {
      safeUpdate.password = await bcrypt.hash(safeUpdate.password, 10);
    }

    if (safeUpdate.email) {
      safeUpdate.email = safeUpdate.email.trim().toLowerCase();
    }

    const updated = await User.findOneAndUpdate({ user_id }, safeUpdate, {
      new: true,
    })
      .select('-password -__v -_id')
      .exec();

    if (!updated) return res.status(404).json({ error: 'User not found' });

    return res.status(200).json(updated);
  } catch (err) {
    console.error('admin update user error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /auth/admin/user/:user_id
router.delete('/admin/user/:user_id', requireAdmin, async (req, res) => {
  try {
    const { user_id } = req.params;

    const deleted = await User.findOneAndDelete({ user_id }).exec();
    if (!deleted) return res.status(404).json({ error: 'User not found' });

    return res.status(200).json({
      deleted: true,
      user: { user_id: deleted.user_id, email: deleted.email },
    });
  } catch (err) {
    console.error('admin delete user error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
