const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth'));

router.use('/posts', require('./posts'));

router.use('/logs', require('./logs'));

router.use('/billing', require('./billing'));

router.use('/comments', require('./comments'));

router.use('/images', require('./images'));

module.exports = router;
