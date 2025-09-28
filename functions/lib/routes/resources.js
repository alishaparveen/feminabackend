"use strict";
/**
 * Resources Routes for Femina Platform
 * Handles educational content, articles, and resource management
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resourcesRoutes = void 0;
const express_1 = require("express");
const firestore_1 = require("firebase-admin/firestore");
const zod_1 = require("zod");
const validation_1 = require("../middleware/validation");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
exports.resourcesRoutes = router;
const db = (0, firestore_1.getFirestore)();
// Validation schemas
const createResourceSchema = zod_1.z.object({
    title: zod_1.z.string().min(5).max(200),
    description: zod_1.z.string().min(20).max(1000),
    content: zod_1.z.string().min(100).max(50000),
    category: zod_1.z.enum(['health', 'career', 'relationships', 'parenting', 'fitness', 'mental_health', 'nutrition', 'lifestyle']),
    type: zod_1.z.enum(['article', 'guide', 'video', 'podcast', 'infographic', 'checklist']),
    tags: zod_1.z.array(zod_1.z.string()).max(10).optional(),
    featuredImage: zod_1.z.string().url().optional(),
    readingTime: zod_1.z.number().min(1).max(120).optional(),
    difficulty: zod_1.z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
    sources: zod_1.z.array(zod_1.z.object({
        title: zod_1.z.string(),
        url: zod_1.z.string().url(),
        type: zod_1.z.enum(['research', 'article', 'book', 'website'])
    })).optional()
});
const updateResourceSchema = zod_1.z.object({
    title: zod_1.z.string().min(5).max(200).optional(),
    description: zod_1.z.string().min(20).max(1000).optional(),
    content: zod_1.z.string().min(100).max(50000).optional(),
    tags: zod_1.z.array(zod_1.z.string()).max(10).optional(),
    featuredImage: zod_1.z.string().url().optional(),
    readingTime: zod_1.z.number().min(1).max(120).optional(),
    difficulty: zod_1.z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    sources: zod_1.z.array(zod_1.z.object({
        title: zod_1.z.string(),
        url: zod_1.z.string().url(),
        type: zod_1.z.enum(['research', 'article', 'book', 'website'])
    })).optional()
});
/**
 * GET /api/resources
 * Get resources with filtering (public endpoint)
 */
router.get('/', async (req, res) => {
    try {
        const { category, type, difficulty, featured = 'false', search, sortBy = 'recent', page = 1, limit = 20 } = req.query;
        let query = db.collection('resources')
            .where('published', '==', true);
        // Apply filters
        if (category) {
            query = query.where('category', '==', category);
        }
        if (type) {
            query = query.where('type', '==', type);
        }
        if (difficulty) {
            query = query.where('difficulty', '==', difficulty);
        }
        if (featured === 'true') {
            query = query.where('featured', '==', true);
        }
        // Apply sorting
        switch (sortBy) {
            case 'popular':
                query = query.orderBy('views', 'desc');
                break;
            case 'rating':
                query = query.orderBy('rating', 'desc');
                break;
            case 'reading_time':
                query = query.orderBy('readingTime', 'asc');
                break;
            case 'recent':
            default:
                query = query.orderBy('publishedAt', 'desc');
                break;
        }
        // Apply pagination
        const offset = (Number(page) - 1) * Number(limit);
        query = query.offset(offset).limit(Number(limit));
        const querySnapshot = await query.get();
        let resources = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            // Remove full content from list view
            content: undefined,
            // Remove sensitive author data
            authorEmail: undefined
        }));
        // Apply search filter if specified
        if (search) {
            const searchTerm = search.toLowerCase();
            resources = resources.filter(resource => {
                const title = resource.title || '';
                const description = resource.description || '';
                const tags = resource.tags || [];
                return (title.toLowerCase().includes(searchTerm) ||
                    description.toLowerCase().includes(searchTerm) ||
                    (Array.isArray(tags) && tags.some((tag) => tag.toLowerCase().includes(searchTerm))));
            });
        }
        // Get author information
        const authorIds = [
            ...new Set(resources
                .map((resource) => resource.authorId)
                .filter((id) => typeof id === 'string' && id.length > 0))
        ];
        const authorsSnapshot = authorIds.length
            ? await db.collection('users')
                .where('uid', 'in', authorIds.slice(0, 10))
                .get()
            : { docs: [] };
        const authorsMap = new Map();
        authorsSnapshot.docs.forEach(doc => {
            const data = doc.data();
            authorsMap.set(doc.id, {
                uid: data.uid,
                displayName: data.displayName,
                photoURL: data.photoURL,
                role: data.role,
                verified: data.verified,
                specialties: data.specialties
            });
        });
        const enrichedResources = resources.map(resource => ({
            ...resource,
            author: authorsMap.get(resource.authorId) || null
        }));
        res.json({
            success: true,
            data: {
                resources: enrichedResources,
                pagination: {
                    currentPage: Number(page),
                    hasMore: querySnapshot.size === Number(limit)
                },
                filters: {
                    category: category || 'all',
                    type: type || 'all',
                    difficulty: difficulty || 'all',
                    featured: featured === 'true',
                    search: search || null,
                    sortBy
                }
            }
        });
    }
    catch (error) {
        console.error('Error fetching resources:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch resources'
        });
    }
});
/**
 * POST /api/resources
 * Create a new resource (expert/admin only)
 */
router.post('/', auth_1.expertOnly, (0, validation_1.validateRequest)(createResourceSchema), async (req, res) => {
    try {
        const userId = req.user.uid;
        const resourceData = req.body;
        // Get user information
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data();
        if (!userData) {
            return res.status(404).json({
                error: 'User Not Found',
                message: 'User profile not found'
            });
        }
        const resourceId = db.collection('resources').doc().id;
        const now = new Date();
        const newResource = {
            id: resourceId,
            authorId: userId,
            authorName: userData.displayName,
            authorRole: userData.role,
            ...resourceData,
            published: userData.role === 'admin', // Auto-publish for admins
            featured: false,
            views: 0,
            likes: 0,
            bookmarks: 0,
            rating: 0,
            ratingCount: 0,
            createdAt: now,
            updatedAt: now,
            publishedAt: userData.role === 'admin' ? now : null,
            moderationStatus: 'approved'
        };
        await db.collection('resources').doc(resourceId).set(newResource);
        // Update user's resource count
        await db.collection('users').doc(userId).update({
            resourceCount: firestore_1.FieldValue.increment(1),
            lastResourceAt: now
        });
        // Log activity
        await db.collection('userActivity').add({
            userId,
            action: 'resource_created',
            resourceId,
            timestamp: now,
            metadata: {
                category: resourceData.category,
                type: resourceData.type
            }
        });
        res.status(201).json({
            success: true,
            data: {
                resourceId,
                published: newResource.published,
                message: newResource.published ?
                    'Resource created and published successfully' :
                    'Resource created successfully. Pending admin approval.'
            }
        });
    }
    catch (error) {
        console.error('Error creating resource:', error);
        res.status(500).json({
            error: 'Create Error',
            message: 'Failed to create resource'
        });
    }
});
/**
 * GET /api/resources/:resourceId
 * Get specific resource with full content
 */
router.get('/:resourceId', async (req, res) => {
    try {
        const { resourceId } = req.params;
        const resourceDoc = await db.collection('resources').doc(resourceId).get();
        if (!resourceDoc.exists) {
            return res.status(404).json({
                error: 'Resource Not Found',
                message: 'Resource not found'
            });
        }
        const resourceData = resourceDoc.data();
        // Check if resource is published (unless user is author or admin)
        const userId = req.user?.uid;
        const userDoc = userId ? await db.collection('users').doc(userId).get() : null;
        const userData = userDoc?.data();
        const isAdmin = userData?.role === 'admin';
        const isAuthor = resourceData.authorId === userId;
        if (!resourceData.published && !isAdmin && !isAuthor) {
            return res.status(404).json({
                error: 'Resource Not Available',
                message: 'This resource is not yet published'
            });
        }
        // Increment view count (only for published resources)
        if (resourceData.published) {
            await resourceDoc.ref.update({
                views: firestore_1.FieldValue.increment(1)
            });
        }
        // Get author information
        const authorDoc = await db.collection('users').doc(resourceData.authorId).get();
        const authorData = authorDoc.data();
        // Check if user has bookmarked this resource
        let userBookmarked = false;
        if (userId) {
            const bookmarkQuery = await db.collection('bookmarks')
                .where('userId', '==', userId)
                .where('itemId', '==', resourceId)
                .where('itemType', '==', 'resource')
                .limit(1)
                .get();
            userBookmarked = !bookmarkQuery.empty;
        }
        // Get related resources
        const relatedQuery = await db.collection('resources')
            .where('category', '==', resourceData.category)
            .where('published', '==', true)
            .orderBy('views', 'desc')
            .limit(5)
            .get();
        const relatedResources = relatedQuery.docs
            .filter(doc => doc.id !== resourceId)
            .map(doc => ({
            id: doc.id,
            title: doc.data().title,
            description: doc.data().description,
            featuredImage: doc.data().featuredImage,
            readingTime: doc.data().readingTime,
            difficulty: doc.data().difficulty
        }));
        const enrichedResource = {
            id: resourceId,
            ...resourceData,
            author: authorData ? {
                uid: authorData.uid,
                displayName: authorData.displayName,
                photoURL: authorData.photoURL,
                role: authorData.role,
                verified: authorData.verified,
                specialties: authorData.specialties,
                bio: authorData.bio
            } : null,
            userBookmarked,
            relatedResources,
            // Remove sensitive data
            authorEmail: undefined
        };
        res.json({
            success: true,
            data: enrichedResource
        });
    }
    catch (error) {
        console.error('Error fetching resource:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch resource'
        });
    }
});
/**
 * PUT /api/resources/:resourceId
 * Update resource (author/admin only)
 */
router.put('/:resourceId', (0, validation_1.validateRequest)(updateResourceSchema), async (req, res) => {
    try {
        const { resourceId } = req.params;
        const userId = req.user.uid;
        const resourceDoc = await db.collection('resources').doc(resourceId).get();
        if (!resourceDoc.exists) {
            return res.status(404).json({
                error: 'Resource Not Found',
                message: 'Resource not found'
            });
        }
        const resourceData = resourceDoc.data();
        // Check permissions
        const userDoc = await db.collection('users').doc(userId).get();
        const isAdmin = userDoc.data()?.role === 'admin';
        const isAuthor = resourceData.authorId === userId;
        if (!isAdmin && !isAuthor) {
            return res.status(403).json({
                error: 'Unauthorized',
                message: 'You can only update your own resources'
            });
        }
        const updateData = {
            ...req.body,
            updatedAt: new Date()
        };
        // If content was changed, might need re-approval
        if (req.body.content && !isAdmin) {
            updateData.published = false;
            updateData.publishedAt = null;
            updateData.moderationStatus = 'pending';
        }
        await resourceDoc.ref.update(updateData);
        // Log activity
        await db.collection('userActivity').add({
            userId,
            action: 'resource_updated',
            resourceId,
            timestamp: new Date(),
            metadata: {
                changes: Object.keys(updateData)
            }
        });
        res.json({
            success: true,
            message: 'Resource updated successfully'
        });
    }
    catch (error) {
        console.error('Error updating resource:', error);
        res.status(500).json({
            error: 'Update Error',
            message: 'Failed to update resource'
        });
    }
});
/**
 * POST /api/resources/:resourceId/bookmark
 * Bookmark or unbookmark a resource
 */
router.post('/:resourceId/bookmark', async (req, res) => {
    try {
        const { resourceId } = req.params;
        const userId = req.user.uid;
        // Check if resource exists
        const resourceDoc = await db.collection('resources').doc(resourceId).get();
        if (!resourceDoc.exists) {
            return res.status(404).json({
                error: 'Resource Not Found',
                message: 'Resource not found'
            });
        }
        // Check if already bookmarked
        const existingBookmark = await db.collection('bookmarks')
            .where('userId', '==', userId)
            .where('itemId', '==', resourceId)
            .where('itemType', '==', 'resource')
            .limit(1)
            .get();
        let bookmarked;
        if (existingBookmark.empty) {
            // Create bookmark
            await db.collection('bookmarks').add({
                userId,
                itemId: resourceId,
                itemType: 'resource',
                createdAt: new Date()
            });
            // Update resource bookmark count
            await resourceDoc.ref.update({
                bookmarks: firestore_1.FieldValue.increment(1)
            });
            bookmarked = true;
        }
        else {
            // Remove bookmark
            await existingBookmark.docs[0].ref.delete();
            // Update resource bookmark count
            await resourceDoc.ref.update({
                bookmarks: firestore_1.FieldValue.increment(-1)
            });
            bookmarked = false;
        }
        // Log activity
        await db.collection('userActivity').add({
            userId,
            action: bookmarked ? 'resource_bookmarked' : 'resource_unbookmarked',
            resourceId,
            timestamp: new Date()
        });
        res.json({
            success: true,
            data: { bookmarked }
        });
    }
    catch (error) {
        console.error('Error toggling bookmark:', error);
        res.status(500).json({
            error: 'Bookmark Error',
            message: 'Failed to update bookmark status'
        });
    }
});
/**
 * GET /api/resources/bookmarked
 * Get user's bookmarked resources
 */
router.get('/bookmarked', async (req, res) => {
    try {
        const userId = req.user.uid;
        const { page = 1, limit = 20 } = req.query;
        // Get user's bookmarks for resources
        const bookmarksQuery = await db.collection('bookmarks')
            .where('userId', '==', userId)
            .where('itemType', '==', 'resource')
            .orderBy('createdAt', 'desc');
        const offset = (Number(page) - 1) * Number(limit);
        const paginatedQuery = bookmarksQuery.offset(offset).limit(Number(limit));
        const bookmarksSnapshot = await paginatedQuery.get();
        // Get the actual resources
        const resourceIds = bookmarksSnapshot.docs.map(doc => doc.data().itemId);
        if (resourceIds.length === 0) {
            return res.json({
                success: true,
                data: {
                    resources: [],
                    pagination: { currentPage: 1, hasMore: false }
                }
            });
        }
        const resourcesSnapshot = await db.collection('resources')
            .where('__name__', 'in', resourceIds)
            .where('published', '==', true)
            .get();
        const resources = resourcesSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            content: undefined // Remove full content from list view
        }));
        // Get author information
        const authorIds = [
            ...new Set(resources
                .map((resource) => resource.authorId)
                .filter((id) => typeof id === 'string' && id.length > 0))
        ];
        const authorsSnapshot = authorIds.length
            ? await db.collection('users')
                .where('uid', 'in', authorIds.slice(0, 10))
                .get()
            : { docs: [] };
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
        const enrichedResources = resources.map(resource => ({
            ...resource,
            author: authorsMap.get(resource.authorId) || null
        }));
        res.json({
            success: true,
            data: {
                resources: enrichedResources,
                pagination: {
                    currentPage: Number(page),
                    hasMore: bookmarksSnapshot.size === Number(limit)
                }
            }
        });
    }
    catch (error) {
        console.error('Error fetching bookmarked resources:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch bookmarked resources'
        });
    }
});
/**
 * POST /api/resources/:resourceId/rating
 * Rate a resource
 */
router.post('/:resourceId/rating', async (req, res) => {
    try {
        const { resourceId } = req.params;
        const userId = req.user.uid;
        const { rating, review } = req.body;
        // Validate rating
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({
                error: 'Invalid Rating',
                message: 'Rating must be between 1 and 5'
            });
        }
        const resourceDoc = await db.collection('resources').doc(resourceId).get();
        if (!resourceDoc.exists) {
            return res.status(404).json({
                error: 'Resource Not Found',
                message: 'Resource not found'
            });
        }
        // Check if user has already rated this resource
        const existingRating = await db.collection('resourceRatings')
            .where('userId', '==', userId)
            .where('resourceId', '==', resourceId)
            .get();
        if (!existingRating.empty) {
            return res.status(400).json({
                error: 'Already Rated',
                message: 'You have already rated this resource'
            });
        }
        // Create rating
        const ratingId = db.collection('resourceRatings').doc().id;
        await db.collection('resourceRatings').doc(ratingId).set({
            id: ratingId,
            resourceId,
            userId,
            rating,
            review: review || '',
            createdAt: new Date()
        });
        // Update resource rating
        const resourceData = resourceDoc.data();
        const currentRating = resourceData.rating || 0;
        const currentRatingCount = resourceData.ratingCount || 0;
        const newRatingCount = currentRatingCount + 1;
        const newRating = ((currentRating * currentRatingCount) + rating) / newRatingCount;
        await resourceDoc.ref.update({
            rating: Math.round(newRating * 10) / 10,
            ratingCount: newRatingCount,
            updatedAt: new Date()
        });
        // Send notification to resource author
        await db.collection('notifications').add({
            userId: resourceData.authorId,
            type: 'resource_rated',
            title: 'Resource Rated',
            message: `Someone rated your resource "${resourceData.title}" ${rating} stars`,
            resourceId,
            actionUserId: userId,
            createdAt: new Date(),
            read: false
        });
        // Log activity
        await db.collection('userActivity').add({
            userId,
            action: 'resource_rated',
            resourceId,
            timestamp: new Date(),
            metadata: { rating }
        });
        res.status(201).json({
            success: true,
            data: {
                rating,
                newAverageRating: newRating,
                totalRatings: newRatingCount,
                message: 'Rating submitted successfully'
            }
        });
    }
    catch (error) {
        console.error('Error submitting rating:', error);
        res.status(500).json({
            error: 'Rating Error',
            message: 'Failed to submit rating'
        });
    }
});
/**
 * GET /api/resources/categories
 * Get resource categories with counts
 */
router.get('/categories', async (req, res) => {
    try {
        // Get all published resources and count by category
        const resourcesQuery = await db.collection('resources')
            .where('published', '==', true)
            .get();
        const categoryCount = new Map();
        resourcesQuery.docs.forEach(doc => {
            const resource = doc.data();
            const category = resource.category;
            categoryCount.set(category, (categoryCount.get(category) || 0) + 1);
        });
        // Define categories with metadata
        const categories = [
            { id: 'health', name: 'Health & Wellness', icon: '🏥', description: 'Medical advice and health tips' },
            { id: 'career', name: 'Career & Professional', icon: '💼', description: 'Career development and workplace guidance' },
            { id: 'relationships', name: 'Relationships', icon: '💕', description: 'Dating, marriage, and relationship advice' },
            { id: 'parenting', name: 'Parenting', icon: '👶', description: 'Child-rearing and family guidance' },
            { id: 'fitness', name: 'Fitness & Exercise', icon: '💪', description: 'Workout routines and physical wellness' },
            { id: 'mental_health', name: 'Mental Health', icon: '🧠', description: 'Emotional wellbeing and mental health support' },
            { id: 'nutrition', name: 'Nutrition', icon: '🥗', description: 'Diet and nutritional guidance' },
            { id: 'lifestyle', name: 'Lifestyle', icon: '✨', description: 'General lifestyle tips and inspiration' }
        ].map(category => ({
            ...category,
            resourceCount: categoryCount.get(category.id) || 0
        }));
        res.json({
            success: true,
            data: {
                categories,
                totalResources: resourcesQuery.size
            }
        });
    }
    catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch categories'
        });
    }
});
/**
 * GET /api/resources/featured
 * Get featured resources
 */
router.get('/featured', async (req, res) => {
    try {
        const { limit = 6 } = req.query;
        const featuredQuery = await db.collection('resources')
            .where('published', '==', true)
            .where('featured', '==', true)
            .orderBy('views', 'desc')
            .limit(Number(limit))
            .get();
        const resources = featuredQuery.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            content: undefined // Remove full content from list view
        }));
        // Get author information
        const authorIds = [
            ...new Set(resources
                .map((resource) => resource.authorId)
                .filter((id) => typeof id === 'string' && id.length > 0))
        ];
        const authorsSnapshot = authorIds.length
            ? await db.collection('users')
                .where('uid', 'in', authorIds.slice(0, 10))
                .get()
            : { docs: [] };
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
        const enrichedResources = resources.map(resource => ({
            ...resource,
            author: authorsMap.get(resource.authorId) || null
        }));
        res.json({
            success: true,
            data: { resources: enrichedResources }
        });
    }
    catch (error) {
        console.error('Error fetching featured resources:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch featured resources'
        });
    }
});
/**
 * GET /api/resources/search
 * Search resources
 */
router.get('/search', async (req, res) => {
    try {
        const { q, category, type, limit = 20 } = req.query;
        if (!q || q.trim().length < 2) {
            return res.status(400).json({
                error: 'Invalid Query',
                message: 'Search query must be at least 2 characters long'
            });
        }
        const searchTerm = q.toLowerCase().trim();
        let query = db.collection('resources')
            .where('published', '==', true);
        if (category) {
            query = query.where('category', '==', category);
        }
        if (type) {
            query = query.where('type', '==', type);
        }
        query = query.limit(Number(limit));
        const querySnapshot = await query.get();
        // Filter results by search term
        const resources = querySnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(resource => {
            const searchableText = [
                resource.title || '',
                resource.description || '',
                resource.content || '',
                ...(resource.tags || [])
            ].join(' ').toLowerCase();
            return searchableText.includes(searchTerm);
        })
            .map(resource => ({
            ...resource,
            content: undefined // Remove full content from search results
        }));
        res.json({
            success: true,
            data: {
                resources,
                query: searchTerm,
                totalFound: resources.length
            }
        });
    }
    catch (error) {
        console.error('Error searching resources:', error);
        res.status(500).json({
            error: 'Search Error',
            message: 'Failed to search resources'
        });
    }
});
//# sourceMappingURL=resources.js.map