/**
 * Feed Routes for Femina Platform
 * Handles personalized content feeds and discovery
 */

import { Router, Response } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { validateRequest } from '../middleware/validation';
import { AuthenticatedRequest } from '../types/auth';

const router = Router();
const db = getFirestore();

// Validation schemas
const feedFiltersSchema = z.object({
  categories: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  expertContent: z.boolean().optional(),
  timeframe: z.enum(['24h', '7d', '30d', 'all']).default('7d'),
  sortBy: z.enum(['recent', 'popular', 'trending', 'recommended']).default('recommended')
});

const updatePreferencesSchema = z.object({
  interests: z.array(z.string()),
  categories: z.array(z.string()),
  expertFollowing: z.array(z.string()).optional(),
  notificationSettings: z.object({
    newPosts: z.boolean().default(true),
    expertContent: z.boolean().default(true),
    trending: z.boolean().default(false)
  }).optional()
});

/**
 * GET /api/feed/personal
 * Get personalized feed for the user
 */
router.get('/personal', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;
    const { 
      page = 1, 
      limit = 20,
      categories,
      tags,
      expertContent,
      timeframe = '7d',
      sortBy = 'recommended'
    } = req.query;

    // Get user preferences
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    const userInterests = userData?.interests || [];
    const followedExperts = userData?.followedExperts || [];

    // Calculate timeframe date
    const timeframeDays = timeframe === '24h' ? 1 : 
      timeframe === '7d' ? 7 : 
        timeframe === '30d' ? 30 : null;
    
    const startDate = timeframeDays ? new Date(Date.now() - timeframeDays * 24 * 60 * 60 * 1000) : null;

    // Build base query
    let query = db.collection('posts')
      .where('moderationStatus', 'not-in', ['removed', 'pending']);

    // Apply time filter
    if (startDate) {
      query = query.where('createdAt', '>=', startDate);
    }

    // Apply category filter
    if (categories) {
      const categoryArray = Array.isArray(categories) ? categories : [categories];
      query = query.where('category', 'in', categoryArray);
    }

    // Apply expert content filter
    if (expertContent === 'true') {
      query = query.where('authorRole', '==', 'expert');
    }

    // Execute query with pagination
    query = query.orderBy('createdAt', 'desc');
    const offset = (Number(page) - 1) * Number(limit);
    query = query.offset(offset).limit(Number(limit) * 2); // Get extra for filtering

    const querySnapshot = await query.get();
    let posts = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Apply tag filter if specified
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      posts = posts.filter(post => 
        (post as any).tags && (post as any).tags.some((tag: string) => tagArray.includes(tag))
      );
    }

    // Score posts for personalization
    const scoredPosts = posts.map(post => ({
      ...post,
      score: calculatePersonalizationScore(post, userInterests, followedExperts, userData)
    }));

    // Sort based on preference
    switch (sortBy) {
    case 'recent':
      scoredPosts.sort((a, b) => (b as any).createdAt.toDate().getTime() - (a as any).createdAt.toDate().getTime());
      break;
    case 'popular':
      scoredPosts.sort((a, b) => ((b as any).likes + (b as any).comments * 2) - ((a as any).likes + (a as any).comments * 2));
      break;
    case 'trending':
      scoredPosts.sort((a, b) => calculateTrendingScore(b) - calculateTrendingScore(a));
      break;
    case 'recommended':
    default:
      scoredPosts.sort((a, b) => b.score - a.score);
      break;
    }

    // Take only the requested number of posts
    const finalPosts = scoredPosts.slice(0, Number(limit));

    // Get author information for posts
    const authorIds = [...new Set(finalPosts.map(post => (post as any).authorId))];
    const authorsSnapshot = await db.collection('users')
      .where('uid', 'in', authorIds.slice(0, 10)) // Firestore limit
      .get();
    
    const authorsMap = new Map();
    authorsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      authorsMap.set(doc.id, {
        uid: data.uid,
        displayName: data.displayName,
        photoURL: data.photoURL,
        role: data.role,
        verified: data.verified
      });
    });

    // Enrich posts with author data
    const enrichedPosts = finalPosts.map(post => ({
      ...post,
      author: authorsMap.get((post as any).authorId) || null,
      score: undefined // Remove score from response
    }));

    // Update user's feed cache
    await updateFeedCache(userId, enrichedPosts);

    res.json({
      success: true,
      data: {
        posts: enrichedPosts,
        pagination: {
          currentPage: Number(page),
          hasMore: querySnapshot.size === Number(limit) * 2,
          totalShown: enrichedPosts.length
        },
        filters: {
          categories: categories || 'all',
          timeframe,
          sortBy,
          expertContent: expertContent === 'true'
        }
      }
    });

  } catch (error) {
    console.error('Error fetching personal feed:', error);
    res.status(500).json({
      error: 'Feed Error',
      message: 'Failed to fetch personalized feed'
    });
  }
});

/**
 * GET /api/feed/trending
 * Get trending posts across the platform
 */
router.get('/trending', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { 
      page = 1, 
      limit = 20,
      timeframe = '7d',
      category 
    } = req.query;

    // Calculate timeframe
    const timeframeDays = timeframe === '24h' ? 1 : 
      timeframe === '7d' ? 7 : 
        timeframe === '30d' ? 30 : 7;
    
    const startDate = new Date(Date.now() - timeframeDays * 24 * 60 * 60 * 1000);

    // Build query
    let query = db.collection('posts')
      .where('createdAt', '>=', startDate)
      .where('moderationStatus', 'not-in', ['removed', 'pending']);

    if (category) {
      query = query.where('category', '==', category);
    }

    // Get posts with high engagement
    query = query.where('likes', '>=', 5); // Minimum engagement threshold
    
    const querySnapshot = await query.get();
    let posts = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Calculate trending scores and sort
    const trendingPosts = posts
      .map(post => ({
        ...post,
        trendingScore: calculateTrendingScore(post)
      }))
      .sort((a, b) => b.trendingScore - a.trendingScore);

    // Paginate
    const offset = (Number(page) - 1) * Number(limit);
    const paginatedPosts = trendingPosts.slice(offset, offset + Number(limit));

    // Get author information
    const authorIds = [...new Set(paginatedPosts.map(post => (post as any).authorId))];
    const authorsSnapshot = await db.collection('users')
      .where('uid', 'in', authorIds.slice(0, 10))
      .get();
    
    const authorsMap = new Map();
    authorsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      authorsMap.set(doc.id, {
        uid: data.uid,
        displayName: data.displayName,
        photoURL: data.photoURL,
        role: data.role,
        verified: data.verified
      });
    });

    const enrichedPosts = paginatedPosts.map(post => ({
      ...post,
      author: authorsMap.get((post as any).authorId) || null,
      trendingScore: undefined
    }));

    res.json({
      success: true,
      data: {
        posts: enrichedPosts,
        pagination: {
          currentPage: Number(page),
          hasMore: offset + Number(limit) < trendingPosts.length,
          totalCount: trendingPosts.length
        },
        timeframe
      }
    });

  } catch (error) {
    console.error('Error fetching trending feed:', error);
    res.status(500).json({
      error: 'Feed Error',
      message: 'Failed to fetch trending posts'
    });
  }
});

/**
 * GET /api/feed/experts
 * Get posts from followed experts
 */
router.get('/experts', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;
    const { page = 1, limit = 20 } = req.query;

    // Get user's followed experts
    const userDoc = await db.collection('users').doc(userId).get();
    const followedExperts = userDoc.data()?.followedExperts || [];

    if (followedExperts.length === 0) {
      return res.json({
        success: true,
        data: {
          posts: [],
          pagination: { currentPage: 1, hasMore: false },
          message: 'No followed experts yet'
        }
      });
    }

    // Get posts from followed experts
    const query = db.collection('posts')
      .where('authorId', 'in', followedExperts.slice(0, 10)) // Firestore limit
      .where('moderationStatus', 'not-in', ['removed', 'pending'])
      .orderBy('createdAt', 'desc');

    const offset = (Number(page) - 1) * Number(limit);
    const paginatedQuery = query.offset(offset).limit(Number(limit));

    const querySnapshot = await paginatedQuery.get();
    const posts = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Get expert information
    const expertsSnapshot = await db.collection('users')
      .where('uid', 'in', followedExperts.slice(0, 10))
      .get();
    
    const expertsMap = new Map();
    expertsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      expertsMap.set(doc.id, {
        uid: data.uid,
        displayName: data.displayName,
        photoURL: data.photoURL,
        role: data.role,
        specialties: data.specialties,
        verified: data.verified
      });
    });

    const enrichedPosts = posts.map(post => ({
      ...post,
      author: expertsMap.get((post as any).authorId) || null
    }));

    res.json({
      success: true,
      data: {
        posts: enrichedPosts,
        pagination: {
          currentPage: Number(page),
          hasMore: querySnapshot.size === Number(limit)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching expert feed:', error);
    res.status(500).json({
      error: 'Feed Error',
      message: 'Failed to fetch expert posts'
    });
  }
});

/**
 * PUT /api/feed/preferences
 * Update user's feed preferences
 */
router.put('/preferences', validateRequest(updatePreferencesSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;
    const { interests, categories, expertFollowing, notificationSettings } = req.body;

    const updateData: any = {
      interests,
      preferredCategories: categories,
      feedPreferences: {
        interests,
        categories,
        updatedAt: new Date()
      }
    };

    if (expertFollowing) {
      updateData.followedExperts = expertFollowing;
    }

    if (notificationSettings) {
      updateData['settings.notifications.feed'] = notificationSettings;
    }

    await db.collection('users').doc(userId).update(updateData);

    // Clear feed cache to force regeneration
    await db.collection('feedCache').doc(userId).delete();

    res.json({
      success: true,
      message: 'Feed preferences updated successfully'
    });

  } catch (error) {
    console.error('Error updating feed preferences:', error);
    res.status(500).json({
      error: 'Update Error',
      message: 'Failed to update feed preferences'
    });
  }
});

/**
 * GET /api/feed/suggestions
 * Get content suggestions based on user activity
 */
router.get('/suggestions', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;
    const { type = 'all', limit = 10 } = req.query;

    // Get user's activity and preferences
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    // Get user's recent interactions
    const recentLikes = await db.collection('posts')
      .where('likedBy', 'array-contains', userId)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const recentComments = await db.collection('comments')
      .where('authorId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();

    // Analyze user preferences
    const activityData = {
      likedCategories: new Map(),
      likedTags: new Map(),
      interactedAuthors: new Map()
    };

    recentLikes.docs.forEach(doc => {
      const post = doc.data();
      // Count category preferences
      if (post.category) {
        activityData.likedCategories.set(
          post.category,
          (activityData.likedCategories.get(post.category) || 0) + 1
        );
      }
      // Count tag preferences
      if (post.tags) {
        post.tags.forEach((tag: string) => {
          activityData.likedTags.set(tag, (activityData.likedTags.get(tag) || 0) + 1);
        });
      }
      // Count author interactions
      if (post.authorId) {
        activityData.interactedAuthors.set(
          post.authorId,
          (activityData.interactedAuthors.get(post.authorId) || 0) + 1
        );
      }
    });

    // Generate suggestions based on type
    let suggestions: any[] = [];

    if (type === 'all' || type === 'experts') {
      const expertSuggestions = await generateExpertSuggestions(userId, activityData, userData);
      suggestions = suggestions.concat(expertSuggestions);
    }

    if (type === 'all' || type === 'content') {
      const contentSuggestions = await generateContentSuggestions(userId, activityData, userData);
      suggestions = suggestions.concat(contentSuggestions);
    }

    if (type === 'all' || type === 'categories') {
      const categorySuggestions = await generateCategorySuggestions(userId, activityData, userData);
      suggestions = suggestions.concat(categorySuggestions);
    }

    // Sort by relevance and limit
    suggestions.sort((a, b) => b.relevanceScore - a.relevanceScore);
    suggestions = suggestions.slice(0, Number(limit));

    res.json({
      success: true,
      data: {
        suggestions,
        basedOn: 'user_activity_and_preferences',
        generatedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Error generating feed suggestions:', error);
    res.status(500).json({
      error: 'Suggestion Error',
      message: 'Failed to generate suggestions'
    });
  }
});

// Helper functions
function calculatePersonalizationScore(post: any, userInterests: string[], followedExperts: string[], userData: any): number {
  let score = 0;

  // Base recency score (newer posts get higher score)
  const ageInHours = (Date.now() - post.createdAt.toDate().getTime()) / (1000 * 60 * 60);
  score += Math.max(0, 24 - ageInHours) * 2; // Up to 48 points for recency

  // Interest matching
  if (post.tags) {
    const matchingInterests = post.tags.filter((tag: string) => userInterests.includes(tag));
    score += matchingInterests.length * 15; // 15 points per matching interest
  }

  // Category preference
  if (userData?.preferredCategories?.includes(post.category)) {
    score += 20;
  }

  // Expert content bonus
  if (followedExperts.includes(post.authorId)) {
    score += 30;
  }

  // Engagement score
  score += (post.likes || 0) * 2;
  score += (post.comments || 0) * 5;

  // Diversity bonus (avoid echo chambers)
  if (!userInterests.includes(post.category)) {
    score += 5; // Small bonus for diverse content
  }

  return score;
}

function calculateTrendingScore(post: any): number {
  const now = Date.now();
  const postTime = post.createdAt.toDate().getTime();
  const ageInHours = (now - postTime) / (1000 * 60 * 60);

  // Engagement score
  const likes = post.likes || 0;
  const comments = post.comments || 0;
  const engagementScore = likes + (comments * 3); // Comments worth more

  // Time decay factor (newer posts get bonus)
  const timeFactor = Math.exp(-ageInHours / 24); // Exponential decay over 24 hours

  // Expert content bonus
  const expertBonus = post.authorRole === 'expert' ? 1.2 : 1.0;

  return engagementScore * timeFactor * expertBonus;
}

async function updateFeedCache(userId: string, posts: any[]): Promise<void> {
  try {
    await db.collection('feedCache').doc(userId).set({
      userId,
      posts: posts.slice(0, 20), // Cache first 20 posts
      generatedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes cache
    }, { merge: true });
  } catch (error) {
    console.error('Error updating feed cache:', error);
    // Non-critical error, don't throw
  }
}

async function generateExpertSuggestions(userId: string, activityData: any, userData: any): Promise<any[]> {
  // Logic to suggest experts based on user interests and activity
  const suggestions: any[] = [];
  
  // This would typically involve complex recommendation algorithms
  // For now, return a simple structure
  
  return suggestions;
}

async function generateContentSuggestions(userId: string, activityData: any, userData: any): Promise<any[]> {
  const suggestions: any[] = [];
  
  // Generate content suggestions based on user activity
  
  return suggestions;
}

async function generateCategorySuggestions(userId: string, activityData: any, userData: any): Promise<any[]> {
  const suggestions: any[] = [];
  
  // Generate category suggestions
  
  return suggestions;
}

export { router as feedRoutes };