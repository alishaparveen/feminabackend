const express = require('express');
const router = express.Router();
const storiesController = require('../controllers/storiesController');

router.post('/', storiesController.createStory);

router.get('/', storiesController.getStories);

router.get('/search', async (req, res) => {
  const algoliasearch = require('algoliasearch');
  const client = algoliasearch(
    process.env.ALGOLIA_APP_ID,
    process.env.ALGOLIA_SEARCH_API_KEY
  );
  const index = client.initIndex('stories_index');

  try {
    const query = req.query.q || '';
    const { hits } = await index.search(query, { hitsPerPage: 10 });
    res.json(hits);
  } catch (err) {
    console.error('Algolia search error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', storiesController.getStoryById);

router.put('/:id', storiesController.updateStory);

router.delete('/:id', storiesController.deleteStory);

router.post('/:id/like', storiesController.toggleLike);

router.post('/:id/save', storiesController.toggleSave);

router.post('/:id/follow-author', storiesController.toggleFollow);

router.post('/:id/view', storiesController.incrementView);

module.exports = router;
