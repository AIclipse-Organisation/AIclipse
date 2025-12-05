// MongoDB/routes/media.images.route.js
const express = require('express');
const router = express.Router();

const imagesCtrl = require('../controllers/media.images.controller');

router.post('/', imagesCtrl.createImage);
router.get('/', imagesCtrl.listImages);
router.get('/:image_id', imagesCtrl.getImage);

router.delete('/:image_id', imagesCtrl.deleteImage);

module.exports = router;   
