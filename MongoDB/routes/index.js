const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth.users.route'));
router.use('/posts', require('./community.posts.route'));
router.use('/comments', require('./community.comments.route'));
router.use('/images', require('./media.images.route'));

module.exports = router;
