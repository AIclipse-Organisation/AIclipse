const express = require('express');
const router = express.Router();

const authCtrl = require('../controllers/auth.users.controller');

// PUBLIC ROUTES
router.post('/signup', authCtrl.signup);
router.post('/login', authCtrl.login);

// USER SELF-ACTIONS
router.patch('/me', authCtrl.requireUser, authCtrl.updateMe);
router.delete('/me', authCtrl.requireUser, authCtrl.deleteMe);
router.get('/me', authCtrl.requireUser, authCtrl.getMe);

// ADMIN ROUTES
router.get('/admin/users', authCtrl.requireAdmin, authCtrl.adminListUsers);
router.get('/admin/user/:user_id', authCtrl.requireAdmin, authCtrl.adminGetUser);
router.patch('/admin/user/:user_id', authCtrl.requireAdmin, authCtrl.adminUpdateUser);
router.delete('/admin/user/:user_id', authCtrl.requireAdmin, authCtrl.adminDeleteUser);

module.exports = router;
