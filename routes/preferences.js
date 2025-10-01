const express = require('express');
const router = express.Router();
const preferencesService = require('../services/preferencesService');

router.get('/me/preferences', async (req, res) => {
  try {
    const uid = req.user.uid;
    const preferences = await preferencesService.getUserPreferences(uid);

    res.json({
      success: true,
      data: preferences
    });
  } catch (error) {
    console.error('Error fetching preferences:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch preferences',
      message: error.message
    });
  }
});

router.put('/me/preferences', async (req, res) => {
  try {
    const uid = req.user.uid;
    const updates = req.body;

    if (updates.savedFilters) {
      return res.status(400).json({
        success: false,
        error: 'Cannot update savedFilters directly',
        message: 'Use the filter-specific endpoints to manage saved filters'
      });
    }

    if (updates.followedCategories && Array.isArray(updates.followedCategories)) {
      updates.followedCategories.forEach(cat => preferencesService.validateCategory(cat));
    }

    const updatedPreferences = await preferencesService.updateUserPreferences(uid, updates);

    res.json({
      success: true,
      data: updatedPreferences,
      message: 'Preferences updated successfully'
    });
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to update preferences',
      message: error.message
    });
  }
});

router.post('/me/preferences/follow', async (req, res) => {
  try {
    const uid = req.user.uid;
    const { category } = req.body;

    if (!category) {
      return res.status(400).json({
        success: false,
        error: 'Category is required'
      });
    }

    const followedCategories = await preferencesService.followCategory(uid, category);

    res.json({
      success: true,
      data: { followedCategories },
      message: `Now following ${category}`
    });
  } catch (error) {
    console.error('Error following category:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to follow category',
      message: error.message
    });
  }
});

router.post('/me/preferences/unfollow', async (req, res) => {
  try {
    const uid = req.user.uid;
    const { category } = req.body;

    if (!category) {
      return res.status(400).json({
        success: false,
        error: 'Category is required'
      });
    }

    const followedCategories = await preferencesService.unfollowCategory(uid, category);

    res.json({
      success: true,
      data: { followedCategories },
      message: `Unfollowed ${category}`
    });
  } catch (error) {
    console.error('Error unfollowing category:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to unfollow category',
      message: error.message
    });
  }
});

router.post('/me/preferences/filters', async (req, res) => {
  try {
    const uid = req.user.uid;
    const { name, type, query } = req.body;

    if (!name || !type || !query) {
      return res.status(400).json({
        success: false,
        error: 'Name, type, and query are required'
      });
    }

    const filter = await preferencesService.createSavedFilter(uid, { name, type, query });

    res.status(201).json({
      success: true,
      data: { filter },
      message: 'Filter created successfully'
    });
  } catch (error) {
    console.error('Error creating filter:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to create filter',
      message: error.message
    });
  }
});

router.put('/me/preferences/filters/:filterId', async (req, res) => {
  try {
    const uid = req.user.uid;
    const { filterId } = req.params;
    const updates = req.body;

    const filter = await preferencesService.updateSavedFilter(uid, filterId, updates);

    res.json({
      success: true,
      data: { filter },
      message: 'Filter updated successfully'
    });
  } catch (error) {
    console.error('Error updating filter:', error);
    const statusCode = error.message === 'Filter not found' ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      error: 'Failed to update filter',
      message: error.message
    });
  }
});

router.delete('/me/preferences/filters/:filterId', async (req, res) => {
  try {
    const uid = req.user.uid;
    const { filterId } = req.params;

    await preferencesService.deleteSavedFilter(uid, filterId);

    res.json({
      success: true,
      message: 'Filter deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting filter:', error);
    const statusCode = error.message === 'Filter not found' ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      error: 'Failed to delete filter',
      message: error.message
    });
  }
});

router.get('/recommendations/categories', async (req, res) => {
  try {
    const { age, gender } = req.query;
    
    let userCategories = [];
    if (req.user) {
      const prefs = await preferencesService.getUserPreferences(req.user.uid);
      userCategories = prefs.followedCategories || [];
    }

    const ageNum = age ? parseInt(age, 10) : null;
    const recommendations = await preferencesService.getRecommendedCategories(
      userCategories,
      ageNum,
      gender
    );

    res.json({
      success: true,
      data: { recommendations }
    });
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recommendations',
      message: error.message
    });
  }
});

module.exports = router;
