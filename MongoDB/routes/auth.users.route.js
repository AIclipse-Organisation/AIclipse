const express = require('express');
const router = express.Router();

const authCtrl = require('../controllers/auth.users.controller');

/* -------------------------------------------------------------------------- */
/*                                  PUBLIC                                    */
/* -------------------------------------------------------------------------- */

// Create new user account
router.post('/signup', authCtrl.signup);

// Login and return JWT token
router.post('/login', authCtrl.login);

/* -------------------------------------------------------------------------- */
/*                             USER SELF-ACTIONS                               */
/* -------------------------------------------------------------------------- */

// Update own user profile
router.patch('/me', authCtrl.requireUser, authCtrl.updateMe);

// Delete own user account
router.delete('/me', authCtrl.requireUser, authCtrl.deleteMe);

// Get own user account details
router.get('/me', authCtrl.requireUser, authCtrl.getMe);

/* -------------------------------------------------------------------------- */
/*                                  ADMIN                                     */
/* -------------------------------------------------------------------------- */

// Get full user list (admin only)
router.get('/admin/users', authCtrl.requireAdmin, authCtrl.adminListUsers);

// Get specific user details
router.get('/admin/user/:user_id', authCtrl.requireAdmin, authCtrl.adminGetUser);

// Update a user (admin)
router.patch('/admin/user/:user_id', authCtrl.requireAdmin, authCtrl.adminUpdateUser);

// Delete a user (admin)
router.delete('/admin/user/:user_id', authCtrl.requireAdmin, authCtrl.adminDeleteUser);

module.exports = router;
