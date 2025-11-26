const express = require('express');
const router = express.Router();

const commentsCtrl = require('../controllers/community.comments.controller');

// PUBLIC ROUTES
router.post('/', commentsCtrl.createComment);
router.get('/', commentsCtrl.listComments);
router.get('/:comment_id', commentsCtrl.getComment);

// AUTHORIZED USER ROUTES (Author or Admin)
router.patch('/:comment_id', commentsCtrl.updateComment);
router.delete('/:comment_id', commentsCtrl.deleteComment);

module.exports = router;