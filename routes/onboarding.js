const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const db = admin.firestore();

const VALID_PILLARS = ['health', 'money', 'heart', 'life', 'soul'];

router.get('/users/me', async (req, res) => {
  try {
    const userId = req.user.uid;
    
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User profile does not exist'
      });
    }

    const userData = userDoc.data();

    res.json({
      success: true,
      user: {
        id: userData.id || userId,
        email: req.user.email,
        name: userData.name,
        age: userData.age,
        pillars: userData.pillars,
        tags: userData.tags,
        onboardingCompletedAt: userData.onboardingCompletedAt,
        preferences: userData.preferences,
        createdAt: userData.createdAt,
        updatedAt: userData.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch user profile'
    });
  }
});

router.delete('/users/me', async (req, res) => {
  try {
    const userId = req.user.uid;

    await db.collection('users').doc(userId).delete();

    res.json({
      success: true,
      message: 'User data deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting user data:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete user data'
    });
  }
});

router.post('/onboard', async (req, res) => {
  try {
    const { name, age, pillars, tags = [] } = req.body;
    const userId = req.user.uid;

    const errors = {};
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      errors.name = 'Name is required';
    } else if (name.trim().length > 50) {
      errors.name = 'Name must be 50 characters or less';
    }
    
    if (age === undefined || age === null || typeof age !== 'number') {
      errors.age = 'Age is required';
    } else if (age < 13 || age > 120) {
      errors.age = 'Age must be between 13 and 120';
    }
    
    if (!Array.isArray(pillars) || pillars.length === 0) {
      errors.pillars = 'At least one pillar must be selected';
    } else if (pillars.length > 5) {
      errors.pillars = 'Maximum 5 pillars allowed';
    } else if (pillars.some(p => !VALID_PILLARS.includes(p))) {
      errors.pillars = 'Invalid pillar selection';
    }
    
    if (!Array.isArray(tags)) {
      errors.tags = 'Tags must be an array';
    }
    
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid request data',
        details: errors
      });
    }

    const now = new Date().toISOString();
    const userData = {
      id: userId,
      name: name.trim(),
      age,
      pillars,
      tags: Array.isArray(tags) ? tags : [],
      onboardingCompletedAt: now,
      updatedAt: now,
      preferences: {
        pillars,
        tags: Array.isArray(tags) ? tags : [],
        lastUpdated: now
      }
    };

    await db.collection('users').doc(userId).set(userData, { merge: true });

    res.status(200).json({
      success: true,
      user: userData
    });
  } catch (error) {
    console.error('Onboarding error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to save onboarding data'
    });
  }
});

module.exports = router;
