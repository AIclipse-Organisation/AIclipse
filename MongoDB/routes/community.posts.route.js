const express = require('express');
const router = express.Router();

const postsCtrl = require('../controllers/community.posts.controller');

// PUBLIC FEED / READ ROUTES
router.get('/', postsCtrl.listPosts);
router.get('/:post_id', postsCtrl.getPost);

// CREATE / INTERACTION ROUTES 
router.post('/', postsCtrl.createPost);
router.post('/:post_id/vote', postsCtrl.votePost);
router.post('/:post_id/click', postsCtrl.clickPost);

// OWNER / ADMIN ROUTES
router.patch('/:post_id', postsCtrl.updatePost);
router.delete('/:post_id', postsCtrl.deletePost);

module.exports = router;