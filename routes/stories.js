const express = require('express');
const router = express.Router();
const storiesController = require('../controllers/storiesController');

router.post('/', storiesController.createStory);

router.get('/', storiesController.getStories);

router.get('/:id', storiesController.getStoryById);

router.put('/:id', storiesController.updateStory);

router.delete('/:id', storiesController.deleteStory);

router.post('/:id/like', storiesController.toggleLike);

router.post('/:id/save', storiesController.toggleSave);

router.post('/:id/follow-author', storiesController.toggleFollow);

router.post('/:id/view', storiesController.incrementView);

module.exports = router;
