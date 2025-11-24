const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const User = require('../mongo-models/auth.users.model');

const JWT_SECRET = process.env.JWT_SECRET ; 


// im expecting a JWT verification middleware that decodes the token and adds the user info to req.user
// Middleware to require authenticated user so that only logged-in users can access certain routes
//Scenario: Used on routes where the user must be logged in.
//Needs: req.user already set by a JWT middleware.
//Effect: If req.user.user_id is missing → 401 Unauthorized. Otherwise calls next().

function requireUser(req, res, next) {
  const u = req.user;
  if (!u || !u.user_id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Middleware to require admin user for admin-only routes
//Scenario: Used on admin-only routes.
//Needs: req.user.is_admin === true.
//Effect: If not admin → 403 Admin privileges required. Otherwise calls next().

function requireAdmin(req, res, next) {
  const u = req.user;
  if (!u || !u.is_admin) {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
}


/* ------------------------------ PUBLIC ROUTES ------------------------------ */

// POST /auth/signup
//Scenario: New person signing up for an account.
//Input (body): { "user_name": "Alice", "email": "alice@example.com", "password": "plainTextPw" }
//Output (201): json format of created user 


router.post('/signup', async (req, res) => {
 
  // ensures that all required fields are provided and creates a new user account
  try {
    const { user_name, email, password } = req.body || {};
    if (!user_name || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check for existing email
    const existing = await User.findOne({ email: email.trim().toLowerCase() }).exec();
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    // Hash password
    const hashed = await bcrypt.hash(password, 10);

    // If no existing user, create new user
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
      created_at: user.created_at,
    });
  } 
  
  catch (err) {
    console.error('signup error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/login
//Scenario: Existing user logging in to get a JWT.
//Input (body):{ "email": "alice@example.com", "password": "plainTextPw" }
//Output (201): json format of created user 

router.post('/login', async (req, res) => {
  try {

    const { email, password } = req.body || {};

    //check if email and password are provided
    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

    //see if user exists
    const user = await User.findOne({ email: email.trim().toLowerCase() }).exec();
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    //compare password
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    //generate jwt token
    const token = jwt.sign(
      { user_id: user.user_id, email: user.email, is_admin: user.is_admin },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    //return token and user info
    return res.status(200).json({
      token,
      user: {
        user_id: user.user_id,
        user_name: user.user_name,
        email: user.email,
        is_admin: user.is_admin,
      },
    });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ------------------------------ UPDATING AND DELETING YOUR INFO ------------------------------ */

// PATCH /auth/me - user updates their own profile (name, email, password, age)
//Scenario: Logged-in user wants to update their profile info.
//Auth: requireUser – must have valid JWT.
//Input (body): { "user_name": "New Name", "email": "new@email.com", "password": "newPw" }
//Output (200): json format of updated user

router.patch('/me', requireUser, async (req, res) => {
  try {
    // attached { user_id, email, is_admin, ... } to req.user which was set by auth middleware and verified JWT
    const { user_id } = req.user;


    // If body is empty, use an empty object so the rest of the code doesn't crash
    const raw = req.body || {};

    // SECURITY: If any key starts with "$", that means the client is trying to send
    // a MongoDB update operator (like $set, $inc, $push, etc)
    // We don't allow that because it can be abused to override fields we don't intend
    if (Object.keys(raw).some(k => k.startsWith('$'))) {
      return res.status(400).json({ error: 'Update operators not allowed' });
    }

    // Only these fields are allowed to be edited by the user themself
    // Anything else in req.body will be ignored.
    const ALLOWED = ['user_name', 'email', 'password'];
    const safeUpdate = {};

    // Copy only allowed fields from raw into safeUpdate
    // Example: if raw = { user_name: "bob", plan: 3 }, we keep user_name and drop plan because plan is not in ALLOWED
    for (const key of ALLOWED) {
      if (raw[key] !== undefined) {
        safeUpdate[key] = raw[key];
      }
    }

    // If the user is changing their password, we NEVER store it as plain text
    // We hash it with bcrypt before saving to Mongo
    if (safeUpdate.password) {
      safeUpdate.password = await bcrypt.hash(safeUpdate.password, 10);
    }

    // If email is being updated, normalize it by triming spaces and making it lowercase 
    if (safeUpdate.email) {
      safeUpdate.email = safeUpdate.email.trim().toLowerCase();
    }

    // Apply the update in Mongo:
    // Find the user by user_id
    // Apply only safeUpdate fields
    // { new: true } tells Mongoose to return the updated document
    // Then we remove sensitive/internal fields from the response

    const updated = await User.findOneAndUpdate({ user_id }, safeUpdate, {
      new: true,
    })
      .select('-password -__v -_id')
      .exec();

    // If there is no user with this user_id, something is wrong (stale token or deleted user)
    if (!updated) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Send the updated user document back to the client 
    return res.status(200).json(updated);
  } catch (err) {

    console.error('update me error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


// DELETE /auth/me - user deletes their own account
// Scenario: User wants to delete their own account.
// Input: No body; uses req.user.user_id.
// Response (200): { deleted: true, user_id: "...", message: "Your account has been permanently deleted" }
router.delete('/me', requireUser, async (req, res) => {
  try {
    // req.user was set from the JWT in gateway middleware / auth middleware
    const { user_id } = req.user;

    // Try to delete the user's own account
    const deleted = await User.findOneAndDelete({ user_id }).exec();

    // If record somehow no longer exists
    if (!deleted) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json({
      deleted: true,
      user_id: deleted.user_id,
      message: 'Your account has been permanently deleted'
    });

  } catch (err) {
    console.error('delete me error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


// GET /auth/me - user fetches their own profile
//Scenario: User fetching their own profile page.
//Auth: requireUser.
//Input: None.
//Output (200): Full user doc without password : {"user_id": "uuid-v4","user_name": "Alice","email": "alice@example.com","is_admin": false,"created_at": "...","age": 23,"plan": 0,"total_guesses": 0,"total_correct": 0}

router.get('/me', requireUser, async (req, res) => {
  try {
    // req.user comes from JWT middleware 
    const { user_id } = req.user;

    // Look up the user by their user_id
    const user = await User.findOne({ user_id })
      .select('-password -__v -_id')  // never return password / internals
      .exec();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json(user);
  } 
  
  catch (err) 
  {
    console.error('get me error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


/* ------------------------------ ADMIN ROUTES ------------------------------ */

// GET /auth/admin/users
// Alows admin to list and search for users with optional filtering by user_name 
// might have to make it public for so we can let the community search for users
// Scenario: Admin searching or browsing users, optionally by name.
// Auth: requireAdmin.
// Input (query): Optional ?user_name=ali for partial match.
// Output (200): { items: [ user1, user2, ... ] } list of users matching criteria and fields like user_id, user_name, email, is_admin, created_at


router.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    // Get optional query parameters for filtering
    const { user_name } = req.query || {}

    const q = {};

    // user_name supports partial matching using regex , i for case insensitive
    if (user_name) q.user_name = { $regex: user_name, $options: 'i' };

    const items = await User.find(q)
      .sort({ created_at: -1 })
      .select('-password -__v -_id')
      .limit(200)
      .exec();

    return res.status(200).json({ items });
  } 
  catch (err) {
    console.error('admin list users error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


// GET /auth/admin/user/:user_id
// Allows admin to get detailed info about a specific user by user_id
// Scenario: Admin wants to view a specific user’s details.
// Auth: requireAdmin.
// Input (params): /auth/admin/user/USER_UUID
// Output (200): Same as GET/auth/me, but for admin user.

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
// Allows admin to update any user's info name, email, password, is_admin, age
//Scenario: Admin editing someone’s account (name, email, password, age, is_admin).
//Auth: requireAdmin.
//Input (params): user_id , update fields in body { "user_name": "...", "email": "...", "password": "...", "age": ..., "is_admin": ... }
//Output (200): json format of updated user
router.patch('/admin/user/:user_id', requireAdmin, async (req, res) => {
  try {
    const { user_id } = req.params;
    const raw = req.body || {};

    if (Object.keys(raw).some(k => k.startsWith('$'))) {
      return res.status(400).json({ error: 'Update operators not allowed' });
    }

    const ALLOWED = ['user_name', 'email', 'password', 'age', 'is_admin'];
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
// Scenario: Admin deleting a user account.
// Auth: requireAdmin.
// Input (params): user_id.
// Output (200): { deleted: true, user: { user_id, user_name, email } }
router.delete('/admin/user/:user_id', requireAdmin, async (req, res) => {
  try {
    const { user_id } = req.params;

    const deleted = await User.findOneAndDelete({ user_id }).exec();
    if (!deleted) return res.status(404).json({ error: 'User not found' });

    return res.status(200).json({
      deleted: true,
      user: { user_id: deleted.user_id,Username: deleted.user_name, email: deleted.email },
    });
  } catch (err) {
    console.error('admin delete user error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
