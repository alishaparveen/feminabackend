/**
 * Expert Routes for Femina Platform
 * Handles expert profiles, specialties, and discovery
 */

import { Router, Response } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { validateRequest } from '../middleware/validation';
import { AuthenticatedRequest, expertOnly } from '../middleware/auth';

const router = Router();
const db = getFirestore();

// Validation schemas
const updateExpertProfileSchema = z.object({
  bio: z.string().min(50).max(1000).optional(),
  specialties: z.array(z.string()).min(1).max(5).optional(),
  hourlyRate: z.number().min(10).max(1000).optional(),
  experience: z.string().min(20).max(500).optional(),
  certifications: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  availability: z.object({
    timezone: z.string(),
    workingHours: z.object({
      start: z.string(),
      end: z.string()
    }),
    workingDays: z.array(z.number().min(0).max(6))
  }).optional(),
  consultationTypes: z.array(z.enum(['video', 'chat', 'phone'])).optional()
});

const setAvailabilitySchema = z.object({
  available: z.boolean(),
  availableUntil: z.date().optional(),
  reason: z.string().optional()
});

/**
 * GET /api/experts
 * Get list of experts with filtering
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      specialty,
      available = 'true',
      minRating = 0,
      maxRate,
      page = 1,
      limit = 20,
      sortBy = 'rating'
    } = req.query;

    let query: any = db.collection('experts');

    // Apply filters
    if (specialty) {
      query = query.where('specialties', 'array-contains', specialty);
    }

    if (available === 'true') {
      query = query.where('available', '==', true);
    }

    if (Number(minRating) > 0) {
      query = query.where('rating', '>=', Number(minRating));
    }

    if (maxRate) {
      query = query.where('hourlyRate', '<=', Number(maxRate));
    }

    // Apply sorting
    switch (sortBy) {
    case 'rating':
      query = query.orderBy('rating', 'desc');
      break;
    case 'price_low':
      query = query.orderBy('hourlyRate', 'asc');
      break;
    case 'price_high':
      query = query.orderBy('hourlyRate', 'desc');
      break;
    case 'experience':
      query = query.orderBy('experienceYears', 'desc');
      break;
    case 'recent':
    default:
      query = query.orderBy('joinedAt', 'desc');
      break;
    }

    // Apply pagination
    const offset = (Number(page) - 1) * Number(limit);
    query = query.offset(offset).limit(Number(limit));

    const querySnapshot = await query.get();
    const experts = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      // Remove sensitive data
      earnings: undefined,
      stripeConnectId: undefined,
      internalNotes: undefined
    }));

    res.json({
      success: true,
      data: {
        experts,
        pagination: {
          currentPage: Number(page),
          hasMore: querySnapshot.size === Number(limit)
        },
        filters: {
          specialty: specialty || 'all',
          available: available === 'true',
          minRating: Number(minRating),
          maxRate: maxRate ? Number(maxRate) : null,
          sortBy
        }
      }
    });

  } catch (error) {
    console.error('Error fetching experts:', error);
    res.status(500).json({
      error: 'Database Error',
      message: 'Failed to fetch experts'
    });
  }
});

/**
 * GET /api/experts/:expertId
 * Get specific expert profile
 */
router.get('/:expertId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { expertId } = req.params;

    const expertDoc = await db.collection('experts').doc(expertId).get();
    
    if (!expertDoc.exists) {
      return res.status(404).json({
        error: 'Expert Not Found',
        message: 'Expert profile not found'
      });
    }

    const expertData = expertDoc.data()!;

    // Get recent reviews
    const reviewsQuery = await db.collection('reviews')
      .where('expertId', '==', expertId)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const reviews = await Promise.all(
      reviewsQuery.docs.map(async (reviewDoc) => {
        const review = reviewDoc.data();
        
        // Get reviewer info (anonymized)
        const reviewerDoc = await db.collection('users').doc(review.userId).get();
        const reviewerData = reviewerDoc.data();
        
        return {
          id: reviewDoc.id,
          ...review,
          reviewer: {
            displayName: reviewerData?.displayName?.charAt(0) + '***', // Anonymize
            verified: reviewerData?.verified || false
          },
          userId: undefined // Remove sensitive data
        };
      })
    );

    // Get availability for next 7 days
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    
    const availabilityQuery = await db.collection('expertAvailability')
      .where('expertId', '==', expertId)
      .where('date', '>=', new Date())
      .where('date', '<=', nextWeek)
      .where('available', '==', true)
      .orderBy('date', 'asc')
      .get();

    const availability = availabilityQuery.docs.map(doc => doc.data());

    const enrichedExpertData = {
      id: expertId,
      ...expertData,
      reviews: {
        recent: reviews,
        totalCount: expertData.reviewCount || 0,
        averageRating: expertData.rating || 0
      },
      availability,
      // Remove sensitive data
      earnings: undefined,
      stripeConnectId: undefined,
      internalNotes: undefined
    };

    res.json({
      success: true,
      data: enrichedExpertData
    });

  } catch (error) {
    console.error('Error fetching expert profile:', error);
    res.status(500).json({
      error: 'Database Error',
      message: 'Failed to fetch expert profile'
    });
  }
});

/**
 * PUT /api/experts/:expertId
 * Update expert profile (expert only)
 */
router.put('/:expertId', expertOnly, validateRequest(updateExpertProfileSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { expertId } = req.params;
    const userId = req.user!.uid;

    // Check if the expert profile belongs to the current user
    const expertDoc = await db.collection('experts').doc(expertId).get();
    
    if (!expertDoc.exists) {
      return res.status(404).json({
        error: 'Expert Not Found',
        message: 'Expert profile not found'
      });
    }

    const expertData = expertDoc.data()!;
    
    if (expertData.uid !== userId) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'You can only update your own expert profile'
      });
    }

    const updateData = {
      ...req.body,
      updatedAt: new Date()
    };

    await expertDoc.ref.update(updateData);

    // Also update the main user profile if bio or specialties changed
    if (updateData.bio || updateData.specialties) {
      const userUpdateData: any = { updatedAt: new Date() };
      if (updateData.bio) userUpdateData.bio = updateData.bio;
      if (updateData.specialties) userUpdateData.specialties = updateData.specialties;
      
      await db.collection('users').doc(userId).update(userUpdateData);
    }

    // Log activity
    await db.collection('userActivity').add({
      userId,
      action: 'expert_profile_updated',
      expertId,
      timestamp: new Date(),
      metadata: {
        changes: Object.keys(updateData)
      }
    });

    res.json({
      success: true,
      message: 'Expert profile updated successfully'
    });

  } catch (error) {
    console.error('Error updating expert profile:', error);
    res.status(500).json({
      error: 'Update Error',
      message: 'Failed to update expert profile'
    });
  }
});

/**
 * POST /api/experts/:expertId/availability
 * Set expert availability (expert only)
 */
router.post('/:expertId/availability', expertOnly, validateRequest(setAvailabilitySchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { expertId } = req.params;
    const userId = req.user!.uid;
    const { available, availableUntil, reason } = req.body;

    // Check ownership
    const expertDoc = await db.collection('experts').doc(expertId).get();
    
    if (!expertDoc.exists) {
      return res.status(404).json({
        error: 'Expert Not Found',
        message: 'Expert profile not found'
      });
    }

    const expertData = expertDoc.data()!;
    
    if (expertData.uid !== userId) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'You can only update your own availability'
      });
    }

    // Update availability
    const updateData: any = {
      available,
      availabilityUpdatedAt: new Date(),
      updatedAt: new Date()
    };

    if (!available && reason) {
      updateData.unavailableReason = reason;
    }

    if (availableUntil) {
      updateData.availableUntil = availableUntil;
    }

    await expertDoc.ref.update(updateData);

    // If going unavailable, notify users with pending bookings
    if (!available) {
      const pendingBookings = await db.collection('bookings')
        .where('expertId', '==', expertId)
        .where('status', '==', 'confirmed')
        .where('scheduledAt', '>', new Date())
        .get();

      const notificationPromises = pendingBookings.docs.map(async (bookingDoc) => {
        const booking = bookingDoc.data();
        return db.collection('notifications').add({
          userId: booking.userId,
          type: 'expert_unavailable',
          title: 'Expert Unavailable',
          message: `${expertData.displayName} is temporarily unavailable. Your booking may be affected.`,
          expertId,
          bookingId: bookingDoc.id,
          createdAt: new Date(),
          read: false
        });
      });

      await Promise.all(notificationPromises);
    }

    res.json({
      success: true,
      data: {
        available,
        availableUntil,
        message: `Availability updated to ${available ? 'available' : 'unavailable'}`
      }
    });

  } catch (error) {
    console.error('Error updating availability:', error);
    res.status(500).json({
      error: 'Update Error',
      message: 'Failed to update availability'
    });
  }
});

/**
 * GET /api/experts/:expertId/reviews
 * Get expert reviews and ratings
 */
router.get('/:expertId/reviews', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { expertId } = req.params;
    const { page = 1, limit = 20, rating } = req.query;

    let query: any = db.collection('reviews')
      .where('expertId', '==', expertId)
      .orderBy('createdAt', 'desc');

    // Filter by rating if specified
    if (rating) {
      query = query.where('rating', '==', Number(rating));
    }

    // Apply pagination
    const offset = (Number(page) - 1) * Number(limit);
    query = query.offset(offset).limit(Number(limit));

    const querySnapshot = await query.get();
    
    const reviews = await Promise.all(
      querySnapshot.docs.map(async (reviewDoc) => {
        const review = reviewDoc.data();
        
        // Get reviewer info (anonymized for privacy)
        const reviewerDoc = await db.collection('users').doc(review.userId).get();
        const reviewerData = reviewerDoc.data();
        
        return {
          id: reviewDoc.id,
          rating: review.rating,
          comment: review.comment,
          createdAt: review.createdAt,
          consultationType: review.consultationType,
          reviewer: {
            displayName: reviewerData?.displayName ? 
              reviewerData.displayName.charAt(0) + '***' : 'Anonymous',
            verified: reviewerData?.verified || false
          },
          expertResponse: review.expertResponse || null,
          expertResponseAt: review.expertResponseAt || null
        };
      })
    );

    // Get rating distribution
    const allReviewsQuery = await db.collection('reviews')
      .where('expertId', '==', expertId)
      .get();

    const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalRating = 0;

    allReviewsQuery.docs.forEach(doc => {
      const rating = doc.data().rating;
      ratingDistribution[rating as keyof typeof ratingDistribution]++;
      totalRating += rating;
    });

    const averageRating = allReviewsQuery.size > 0 ? totalRating / allReviewsQuery.size : 0;

    res.json({
      success: true,
      data: {
        reviews,
        pagination: {
          currentPage: Number(page),
          hasMore: querySnapshot.size === Number(limit)
        },
        statistics: {
          totalReviews: allReviewsQuery.size,
          averageRating: Math.round(averageRating * 10) / 10,
          ratingDistribution
        }
      }
    });

  } catch (error) {
    console.error('Error fetching expert reviews:', error);
    res.status(500).json({
      error: 'Database Error',
      message: 'Failed to fetch expert reviews'
    });
  }
});

/**
 * GET /api/experts/:expertId/availability
 * Get expert's availability schedule
 */
router.get('/:expertId/availability', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { expertId } = req.params;
    const { startDate, endDate, days = 7 } = req.query;

    let start = startDate ? new Date(startDate as string) : new Date();
    let end = endDate ? new Date(endDate as string) : new Date();
    
    if (!endDate) {
      end.setDate(start.getDate() + Number(days));
    }

    // Get availability slots
    const availabilityQuery = await db.collection('expertAvailability')
      .where('expertId', '==', expertId)
      .where('date', '>=', start)
      .where('date', '<=', end)
      .orderBy('date', 'asc')
      .get();

    const availability = availabilityQuery.docs.map(doc => doc.data());

    // Get expert's general availability settings
    const expertDoc = await db.collection('experts').doc(expertId).get();
    const expertData = expertDoc.data();

    res.json({
      success: true,
      data: {
        slots: availability,
        generalAvailability: expertData?.availability || null,
        dateRange: {
          start,
          end
        }
      }
    });

  } catch (error) {
    console.error('Error fetching expert availability:', error);
    res.status(500).json({
      error: 'Database Error',
      message: 'Failed to fetch availability'
    });
  }
});

/**
 * POST /api/experts/:expertId/follow
 * Follow or unfollow an expert
 */
router.post('/:expertId/follow', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { expertId } = req.params;
    const userId = req.user!.uid;

    // Check if expert exists
    const expertDoc = await db.collection('experts').doc(expertId).get();
    if (!expertDoc.exists) {
      return res.status(404).json({
        error: 'Expert Not Found',
        message: 'Expert not found'
      });
    }

    // Check if already following
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data()!;
    const followedExperts = userData.followedExperts || [];
    const isFollowing = followedExperts.includes(expertId);

    let following: boolean;

    if (isFollowing) {
      // Unfollow
      await userDoc.ref.update({
        followedExperts: FieldValue.arrayRemove(expertId)
      });

      await expertDoc.ref.update({
        followerCount: FieldValue.increment(-1)
      });
      
      following = false;
    } else {
      // Follow
      await userDoc.ref.update({
        followedExperts: FieldValue.arrayUnion(expertId)
      });
      
      await expertDoc.ref.update({
        followerCount: FieldValue.increment(1)
      });

      // Create notification for expert
      await db.collection('notifications').add({
        userId: expertId,
        type: 'new_follower',
        title: 'New Follower',
        message: `${userData.displayName} is now following you`,
        actionUserId: userId,
        createdAt: new Date(),
        read: false
      });
      
      following = true;
    }

    // Log activity
    await db.collection('userActivity').add({
      userId,
      action: following ? 'expert_followed' : 'expert_unfollowed',
      expertId,
      timestamp: new Date()
    });

    res.json({
      success: true,
      data: {
        following,
        message: following ? 'Expert followed successfully' : 'Expert unfollowed successfully'
      }
    });

  } catch (error) {
    console.error('Error toggling expert follow:', error);
    res.status(500).json({
      error: 'Follow Error',
      message: 'Failed to update follow status'
    });
  }
});

/**
 * GET /api/experts/specialties
 * Get all available expert specialties
 */
router.get('/specialties', async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Get all experts and extract unique specialties
    const expertsQuery = await db.collection('experts').get();
    
    const specialtyCount = new Map<string, number>();
    
    expertsQuery.docs.forEach(doc => {
      const expert = doc.data();
      if (expert.specialties && Array.isArray(expert.specialties)) {
        expert.specialties.forEach((specialty: string) => {
          specialtyCount.set(specialty, (specialtyCount.get(specialty) || 0) + 1);
        });
      }
    });

    // Convert to array and sort by popularity
    const specialties = Array.from(specialtyCount.entries())
      .map(([name, count]) => ({ name, expertCount: count }))
      .sort((a, b) => b.expertCount - a.expertCount);

    res.json({
      success: true,
      data: {
        specialties,
        totalExperts: expertsQuery.size
      }
    });

  } catch (error) {
    console.error('Error fetching specialties:', error);
    res.status(500).json({
      error: 'Database Error',
      message: 'Failed to fetch specialties'
    });
  }
});

/**
 * GET /api/experts/search
 * Search experts by name, specialty, or keywords
 */
router.get('/search', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { q, specialty, available = 'true', limit = 20 } = req.query;

    if (!q || (q as string).trim().length < 2) {
      return res.status(400).json({
        error: 'Invalid Query',
        message: 'Search query must be at least 2 characters long'
      });
    }

    const searchTerm = (q as string).toLowerCase().trim();

    // Note: This is a basic implementation. For production, consider using
    // Algolia, Elasticsearch, or Cloud Search for better search capabilities
    let query: any = db.collection('experts');

    if (specialty) {
      query = query.where('specialties', 'array-contains', specialty);
    }

    if (available === 'true') {
      query = query.where('available', '==', true);
    }

    query = query.limit(Number(limit));

    const querySnapshot = await query.get();
    
    // Filter results by search term (client-side filtering for simplicity)
    const experts = querySnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(expert => {
        const searchableText = [
          (expert as any).displayName || '',
          (expert as any).bio || '',
          ...((expert as any).specialties || []),
          ...((expert as any).keywords || [])
        ].join(' ').toLowerCase();
        
        return searchableText.includes(searchTerm);
      })
      .map(expert => ({
        ...expert,
        // Remove sensitive data
        earnings: undefined,
        stripeConnectId: undefined,
        internalNotes: undefined
      }));

    res.json({
      success: true,
      data: {
        experts,
        query: searchTerm,
        totalFound: experts.length
      }
    });

  } catch (error) {
    console.error('Error searching experts:', error);
    res.status(500).json({
      error: 'Search Error',
      message: 'Failed to search experts'
    });
  }
});

/**
 * GET /api/experts/featured
 * Get featured/top experts
 */
router.get('/featured', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit = 10 } = req.query;

    // Get top-rated experts with high booking counts
    const expertQuery = await db.collection('experts')
      .where('available', '==', true)
      .where('rating', '>=', 4.5)
      .where('reviewCount', '>=', 10)
      .orderBy('rating', 'desc')
      .orderBy('reviewCount', 'desc')
      .limit(Number(limit))
      .get();

    const experts = expertQuery.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      // Remove sensitive data
      earnings: undefined,
      stripeConnectId: undefined,
      internalNotes: undefined
    }));

    res.json({
      success: true,
      data: { experts }
    });

  } catch (error) {
    console.error('Error fetching featured experts:', error);
    res.status(500).json({
      error: 'Database Error',
      message: 'Failed to fetch featured experts'
    });
  }
});

export { router as expertsRoutes };