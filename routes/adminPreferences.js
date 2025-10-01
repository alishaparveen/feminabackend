const express = require('express');
const router = express.Router();
const preferencesService = require('../services/preferencesService');

router.post('/seed-preferences', async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    const preferences = await preferencesService.seedDemoPreferences(uid);

    res.json({
      success: true,
      data: { preferences },
      message: 'Demo preferences seeded successfully'
    });
  } catch (error) {
    console.error('Error seeding preferences:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to seed preferences',
      message: error.message
    });
  }
});

module.exports = router;
