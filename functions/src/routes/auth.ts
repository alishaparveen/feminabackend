/**
 * Authentication Routes for Femina Platform
 * Handles user registration, login, profile management
 */

import { Router, Request, Response } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { z } from 'zod';
import { validateRequest } from '../middleware/validation';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';

const router = Router();
const db = getFirestore();

// Validation schemas
const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(50).optional(),
  bio: z.string().max(500).optional(),
  interests: z.array(z.string()).max(20).optional(),
  specialties: z.array(z.string()).max(10).optional(),
  phoneNumber: z.string().optional(),
  website: z.string().url().optional(),
  location: z.object({
    city: z.string().optional(),
    country: z.string().optional()
  }).optional(),
  settings: z.object({
    notifications: z.object({
      email: z.boolean().default(true),
      push: z.boolean().default(true),
      marketing: z.boolean().default(false)
    }).optional(),
    privacy: z.object({
      profileVisibility: z.enum(['public', 'private']).default('public'),
      showOnlineStatus: z.boolean().default(true)
    }).optional()
  }).optional()
});

const becomeExpertSchema = z.object({
  specialties: z.array(z.string()).min(1).max(5),
  bio: z.string().min(50).max(1000),
  hourlyRate: z.number().min(10).max(1000),
  experience: z.string().min(20).max(500),
  certifications: z.array(z.string()).optional(),
  availability: z.object({
    timezone: z.string(),
    workingHours: z.object({
      start: z.string(),
      end: z.string()
    }),
    workingDays: z.array(z.number().min(0).max(6))
  })
});

/**
 * GET /api/auth/profile
 * Get current user's profile
 */
router.get('/profile', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;
    
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        error: 'Profile Not Found',
        message: 'User profile not found'
      });
    }

    const userData = userDoc.data()!;
    
    // Remove sensitive data from response
    const safeUserData = {
      ...userData,
      stripeCustomerId: undefined,
      internalNotes: undefined,
      lastLoginIP: undefined
    };

    res.json({
      success: true,
      data: safeUserData
    });

  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({
      error: 'Database Error',
      message: 'Failed to fetch user profile'
    });
  }
});

/**
 * PUT /api/auth/profile
 * Update user profile
 */
router.put('/profile', authMiddleware, validateRequest(updateProfileSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;
    const updateData = req.body;

    // Add timestamp
    updateData.updatedAt = new Date();
    updateData.lastActive = new Date();

    // Update user document
    await db.collection('users').doc(userId).update(updateData);

    // If display name changed, update Firebase Auth
    if (updateData.displayName) {
      try {
        await getAuth().updateUser(userId, {
          displayName: updateData.displayName
        });
      } catch (authError) {
        console.warn('Failed to update Firebase Auth display name:', authError);
      }
    }

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({
      error: 'Update Error',
      message: 'Failed to update profile'
    });
  }
});

/**
 * POST /api/auth/upload-avatar
 * Upload profile avatar (handled by uploads service, this endpoint updates profile)
 */
router.post('/upload-avatar', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;
    const { photoURL } = req.body;

    if (!photoURL) {
      return res.status(400).json({
        error: 'Missing Photo URL',
        message: 'Photo URL is required'
      });
    }

    // Update user profile with new photo URL
    await db.collection('users').doc(userId).update({
      photoURL,
      updatedAt: new Date()
    });

    // Update Firebase Auth profile
    try {
      await getAuth().updateUser(userId, { photoURL });
    } catch (authError) {
      console.warn('Failed to update Firebase Auth photo:', authError);
    }

    res.json({
      success: true,
      data: { photoURL }
    });

  } catch (error) {
    console.error('Error updating avatar:', error);
    res.status(500).json({
      error: 'Update Error',
      message: 'Failed to update profile photo'
    });
  }
});

/**
 * POST /api/auth/become-expert
 * Apply to become an expert
 */
router.post('/become-expert', authMiddleware, validateRequest(becomeExpertSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;
    const applicationData = req.body;

    // Check if user already has pending application
    const existingApp = await db.collection('expertApplications')
      .where('userId', '==', userId)
      .where('status', 'in', ['pending', 'under_review'])
      .get();

    if (!existingApp.empty) {
      return res.status(400).json({
        error: 'Application Exists',
        message: 'You already have a pending expert application'
      });
    }

    // Create expert application
    const applicationId = db.collection('expertApplications').doc().id;
    await db.collection('expertApplications').doc(applicationId).set({
      id: applicationId,
      userId,
      ...applicationData,
      status: 'pending',
      submittedAt: new Date(),
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null
    });

    // Update user profile to indicate expert application
    await db.collection('users').doc(userId).update({
      expertApplicationId: applicationId,
      expertApplicationStatus: 'pending',
      updatedAt: new Date()
    });

    // Create notification for admins
    await db.collection('adminNotifications').add({
      type: 'expert_application',
      title: 'New Expert Application',
      message: `New expert application from ${req.user!.email}`,
      applicationId,
      userId,
      createdAt: new Date(),
      read: false
    });

    res.json({
      success: true,
      data: {
        applicationId,
        status: 'pending',
        message: 'Expert application submitted successfully'
      }
    });

  } catch (error) {
    console.error('Error submitting expert application:', error);
    res.status(500).json({
      error: 'Application Error',
      message: 'Failed to submit expert application'
    });
  }
});

/**
 * GET /api/auth/notifications
 * Get user's notifications
 */
router.get('/notifications', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;
    const { limit = 20, page = 1, unreadOnly = false } = req.query;

    let query = db.collection('notifications')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc');

    if (unreadOnly === 'true') {
      query = query.where('read', '==', false);
    }

    const offset = (Number(page) - 1) * Number(limit);
    query = query.offset(offset).limit(Number(limit));

    const querySnapshot = await query.get();
    const notifications = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({
      success: true,
      data: {
        notifications,
        pagination: {
          currentPage: Number(page),
          hasMore: querySnapshot.size === Number(limit)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      error: 'Database Error',
      message: 'Failed to fetch notifications'
    });
  }
});

/**
 * PUT /api/auth/notifications/:notificationId/read
 * Mark notification as read
 */
router.put('/notifications/:notificationId/read', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;
    const { notificationId } = req.params;

    const notificationDoc = await db.collection('notifications').doc(notificationId).get();
    
    if (!notificationDoc.exists) {
      return res.status(404).json({
        error: 'Notification Not Found',
        message: 'Notification not found'
      });
    }

    const notificationData = notificationDoc.data()!;
    
    if (notificationData.userId !== userId) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'Cannot access this notification'
      });
    }

    await notificationDoc.ref.update({
      read: true,
      readAt: new Date()
    });

    res.json({
      success: true,
      message: 'Notification marked as read'
    });

  } catch (error) {
    console.error('Error updating notification:', error);
    res.status(500).json({
      error: 'Update Error',
      message: 'Failed to update notification'
    });
  }
});

/**
 * DELETE /api/auth/notifications/:notificationId
 * Delete notification
 */
router.delete('/notifications/:notificationId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;
    const { notificationId } = req.params;

    const notificationDoc = await db.collection('notifications').doc(notificationId).get();
    
    if (!notificationDoc.exists) {
      return res.status(404).json({
        error: 'Notification Not Found',
        message: 'Notification not found'
      });
    }

    const notificationData = notificationDoc.data()!;
    
    if (notificationData.userId !== userId) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'Cannot delete this notification'
      });
    }

    await notificationDoc.ref.delete();

    res.json({
      success: true,
      message: 'Notification deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({
      error: 'Delete Error',
      message: 'Failed to delete notification'
    });
  }
});

/**
 * POST /api/auth/deactivate-account
 * Deactivate user account (soft delete)
 */
router.post('/deactivate-account', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;
    const { reason, feedback } = req.body;

    // Update user status to deactivated
    await db.collection('users').doc(userId).update({
      status: 'deactivated',
      deactivatedAt: new Date(),
      deactivationReason: reason || 'user_request',
      deactivationFeedback: feedback || null,
      updatedAt: new Date()
    });

    // Disable Firebase Auth account
    await getAuth().updateUser(userId, {
      disabled: true
    });

    // Log deactivation event
    await db.collection('userActivity').add({
      userId,
      action: 'account_deactivated',
      reason: reason || 'user_request',
      timestamp: new Date(),
      metadata: {
        feedback: feedback || null
      }
    });

    res.json({
      success: true,
      message: 'Account deactivated successfully'
    });

  } catch (error) {
    console.error('Error deactivating account:', error);
    res.status(500).json({
      error: 'Deactivation Error',
      message: 'Failed to deactivate account'
    });
  }
});

/**
 * GET /api/auth/activity-log
 * Get user's activity history
 */
router.get('/activity-log', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;
    const { limit = 50, page = 1 } = req.query;

    const query = db.collection('userActivity')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .offset((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    const querySnapshot = await query.get();
    const activities = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({
      success: true,
      data: {
        activities,
        pagination: {
          currentPage: Number(page),
          hasMore: querySnapshot.size === Number(limit)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching activity log:', error);
    res.status(500).json({
      error: 'Database Error',
      message: 'Failed to fetch activity log'
    });
  }
});

export { router as authRoutes };