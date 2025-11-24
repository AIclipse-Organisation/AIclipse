const express = require('express');
const router = express.Router();

const authCtrl = require('../controllers/auth.users.controller');

// JWT verification middleware should run before these routes
// so that req.user is set when needed.

router.post('/signup', authCtrl.signup);
router.post('/login', authCtrl.login);

router.patch('/me', authCtrl.requireUser, authCtrl.updateMe);
router.delete('/me', authCtrl.requireUser, authCtrl.deleteMe);
router.get('/me', authCtrl.requireUser, authCtrl.getMe);

router.get('/admin/users', authCtrl.requireAdmin, authCtrl.adminListUsers);
router.get('/admin/user/:user_id', authCtrl.requireAdmin, authCtrl.adminGetUser);
router.patch('/admin/user/:user_id', authCtrl.requireAdmin, authCtrl.adminUpdateUser);
router.delete('/admin/user/:user_id', authCtrl.requireAdmin, authCtrl.adminDeleteUser);

module.exports = router;
