const express = require('express');
const router = express.Router();
const topicsController = require('../controllers/topicsController');

router.get('/topics', topicsController.getTopics);
router.get('/topics/counts', topicsController.getCategoryCounts);

module.exports = router;
