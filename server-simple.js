/**
 * Femina Platform - Complete Social Backend API
 * Women's community platform with posts, comments, likes, moderation
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');
if (!admin.apps.length && serviceAccount.project_id) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
  console.log('✅ Firebase Admin SDK initialized');
}

const db = admin.firestore();

const app = express();

// Basic middleware
app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Categories enum for posts
const CATEGORIES = ['health', 'relationships', 'fitness', 'career', 'fun', 'general', 'parenting', 'lifestyle', 'support'];

// Authentication middleware
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required', message: 'Missing or invalid authorization header' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Get user document for additional info
    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: userData.name || decodedToken.name || 'Anonymous',
      avatarUrl: userData.avatarUrl || decodedToken.picture || null,
      verified: userData.verified || false,
      role: userData.role || 'user'
    };
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Authentication failed', message: 'Invalid token' });
  }
};

// Optional auth middleware (continues if no auth provided)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.split('Bearer ')[1];
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      
      const userDoc = await db.collection('users').doc(decodedToken.uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        name: userData.name || decodedToken.name || 'Anonymous',
        avatarUrl: userData.avatarUrl || decodedToken.picture || null,
        verified: userData.verified || false,
        role: userData.role || 'user'
      };
    }
    next();
  } catch (error) {
    // Continue without authentication if token is invalid
    next();
  }
};

// ========== API ROUTES ==========

// Health check
app.get('/v1/health', (req, res) => {
  res.json({ 
    ok: true,
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    message: 'Femina Backend API is running!' 
  });
});

// Root endpoint for deployment verification
app.get('/', (req, res) => {
  res.type('text').send('Femina API - Backend Running');
});

// ========== POSTS API ==========

// GET /v1/posts - List posts with filters and sorting
app.get('/v1/posts', optionalAuth, async (req, res) => {
  try {
    const {
      category,
      sortBy = 'new',
      timeframe = 'all',
      page = '1',
      limit = '20',
      updatedAfter
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = Math.min(parseInt(limit, 10), 50); // Max 50 per page
    const offset = (pageNum - 1) * limitNum;

    let query = db.collection('posts');

    // Filter by category
    if (category && CATEGORIES.includes(category)) {
      query = query.where('category', '==', category);
    }

    // Exclude pending and removed posts
    query = query.where('moderationStatus', '==', 'approved');

    // Timeframe filtering
    if (timeframe !== 'all') {
      const timeframes = {
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000
      };
      
      if (timeframes[timeframe]) {
        const cutoffTime = new Date(Date.now() - timeframes[timeframe]);
        query = query.where('createdAt', '>=', cutoffTime);
      }
    }

    // UpdatedAfter filter for auto-refresh
    if (updatedAfter) {
      try {
        const afterDate = new Date(updatedAfter);
        query = query.where('updatedAt', '>=', afterDate);
      } catch (e) {
        // Invalid date format, ignore filter
      }
    }

    // Sorting
    switch (sortBy) {
      case 'top':
        query = query.orderBy('likes', 'desc').orderBy('createdAt', 'desc');
        break;
      case 'discussed':
        query = query.orderBy('comments', 'desc').orderBy('createdAt', 'desc');
        break;
      default: // 'new'
        query = query.orderBy('createdAt', 'desc');
    }

    // Pagination
    query = query.offset(offset).limit(limitNum + 1); // +1 to check if there are more

    const snapshot = await query.get();
    const posts = [];
    const hasMore = snapshot.docs.length > limitNum;

    // Process posts (take only the requested limit)
    const docsToProcess = hasMore ? snapshot.docs.slice(0, limitNum) : snapshot.docs;
    
    for (const doc of docsToProcess) {
      const post = { id: doc.id, ...doc.data() };
      
      // Get author info
      if (post.authorId) {
        try {
          const authorDoc = await db.collection('users').doc(post.authorId).get();
          if (authorDoc.exists) {
            const authorData = authorDoc.data();
            post.author = {
              id: post.authorId,
              name: post.isAnonymous ? 'Anonymous' : (authorData.name || 'User'),
              avatarUrl: post.isAnonymous ? null : (authorData.avatarUrl || null),
              verified: post.isAnonymous ? false : (authorData.verified || false)
            };
          }
        } catch (e) {
          console.error('Error fetching author:', e);
        }
      }

      // Convert Firestore timestamps
      if (post.createdAt && post.createdAt.toDate) {
        post.createdAt = post.createdAt.toDate().toISOString();
      }
      if (post.updatedAt && post.updatedAt.toDate) {
        post.updatedAt = post.updatedAt.toDate().toISOString();
      }

      // Remove internal fields
      delete post.authorId;
      
      posts.push(post);
    }

    res.json({
      success: true,
      data: {
        posts,
        pagination: {
          currentPage: pageNum,
          hasMore,
          totalShown: posts.length
        }
      }
    });

  } catch (error) {
    console.error('Error fetching posts:', error);
    
    // Handle empty collection gracefully and index errors
    if (error.code === 5 || error.message.includes('NOT_FOUND')) {
      const pageNum = parseInt(req.query.page || '1', 10);
      return res.json({
        success: true,
        data: {
          posts: [],
          pagination: {
            currentPage: pageNum,
            hasMore: false,
            totalShown: 0
          }
        }
      });
    }
    
    // Handle missing Firestore indexes
    if (error.code === 9 || error.message.includes('FAILED_PRECONDITION')) {
      const pageNum = parseInt(req.query.page || '1', 10);
      return res.json({
        success: true,
        data: {
          posts: [],
          pagination: {
            currentPage: pageNum,
            hasMore: false,
            totalShown: 0
          }
        },
        warning: 'Database indexes need to be created. See IMPLEMENTATION_REPORT.md for details.'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch posts',
      message: error.message
    });
  }
});

// POST /v1/posts - Create new post
app.post('/v1/posts', authenticateUser, async (req, res) => {
  try {
    const {
      content,
      category = 'general',
      images = [],
      tags = [],
      isAnonymous = false
    } = req.body;

    // Validation
    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Content is required'
      });
    }

    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({
        error: 'Validation failed',
        message: `Invalid category. Must be one of: ${CATEGORIES.join(', ')}`
      });
    }

    if (content.length > 5000) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Content too long. Maximum 5000 characters.'
      });
    }

    const now = new Date();
    const postData = {
      content: content.trim(),
      category,
      images: Array.isArray(images) ? images.slice(0, 10) : [], // Max 10 images
      tags: Array.isArray(tags) ? tags.slice(0, 20) : [], // Max 20 tags
      isAnonymous: Boolean(isAnonymous),
      authorId: req.user.uid,
      createdAt: now,
      updatedAt: now,
      moderationStatus: 'approved', // For now, as requested
      likes: 0,
      comments: 0,
      views: 0
    };

    // Create post
    const postRef = await db.collection('posts').add(postData);
    const createdPost = {
      id: postRef.id,
      ...postData,
      createdAt: postData.createdAt.toISOString(),
      updatedAt: postData.updatedAt.toISOString(),
      author: {
        id: req.user.uid,
        name: isAnonymous ? 'Anonymous' : req.user.name,
        avatarUrl: isAnonymous ? null : req.user.avatarUrl,
        verified: isAnonymous ? false : req.user.verified
      }
    };

    // Remove internal authorId
    delete createdPost.authorId;

    res.status(201).json({
      success: true,
      data: {
        post: createdPost
      }
    });

  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create post',
      message: error.message
    });
  }
});

// POST /v1/posts/:id/like - Toggle like on post
app.post('/v1/posts/:id/like', authenticateUser, async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.uid;

    // Use transaction to ensure atomicity
    const result = await db.runTransaction(async (transaction) => {
      const postRef = db.collection('posts').doc(postId);
      const likeRef = db.collection('posts').doc(postId).collection('likes').doc(userId);
      
      const [postDoc, likeDoc] = await transaction.getAll(postRef, likeRef);
      
      if (!postDoc.exists) {
        throw new Error('Post not found');
      }

      const isLiked = likeDoc.exists;
      const currentLikes = postDoc.data().likes || 0;

      if (isLiked) {
        // Unlike: remove like document and decrement count
        transaction.delete(likeRef);
        transaction.update(postRef, { 
          likes: Math.max(0, currentLikes - 1),
          updatedAt: new Date()
        });
        return { liked: false, likes: Math.max(0, currentLikes - 1) };
      } else {
        // Like: create like document and increment count
        transaction.set(likeRef, {
          userId,
          createdAt: new Date()
        });
        transaction.update(postRef, { 
          likes: currentLikes + 1,
          updatedAt: new Date()
        });
        return { liked: true, likes: currentLikes + 1 };
      }
    });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error toggling post like:', error);
    res.status(error.message === 'Post not found' ? 404 : 500).json({
      success: false,
      error: 'Failed to toggle like',
      message: error.message
    });
  }
});

// GET /v1/posts/:id - Get single post (increments view count)
app.get('/v1/posts/:id', optionalAuth, async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user?.uid;

    const postDoc = await db.collection('posts').doc(postId).get();
    
    if (!postDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }

    const post = { id: postDoc.id, ...postDoc.data() };

    // View count deduplication (10-minute window per user)
    if (userId) {
      const now = new Date();
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
      const bucket = Math.floor(now.getTime() / (10 * 60 * 1000)); // 10-minute buckets
      
      const viewRef = db.collection('posts').doc(postId)
        .collection('postViews').doc(`${userId}_${bucket}`);
      
      const viewDoc = await viewRef.get();
      if (!viewDoc.exists) {
        // Record view and increment counter atomically
        await db.runTransaction(async (transaction) => {
          transaction.set(viewRef, {
            userId,
            viewedAt: now,
            bucket
          });
          transaction.update(db.collection('posts').doc(postId), {
            views: admin.firestore.FieldValue.increment(1)
          });
        });
        // Refresh post data to get updated view count
        const updatedPost = await db.collection('posts').doc(postId).get();
        post.views = updatedPost.data().views;
      }
    }

    // Get author info
    if (post.authorId) {
      const authorDoc = await db.collection('users').doc(post.authorId).get();
      if (authorDoc.exists) {
        const authorData = authorDoc.data();
        post.author = {
          id: post.authorId,
          name: post.isAnonymous ? 'Anonymous' : (authorData.name || 'User'),
          avatarUrl: post.isAnonymous ? null : (authorData.avatarUrl || null),
          verified: post.isAnonymous ? false : (authorData.verified || false)
        };
      }
    }

    // Convert timestamps
    if (post.createdAt && post.createdAt.toDate) {
      post.createdAt = post.createdAt.toDate().toISOString();
    }
    if (post.updatedAt && post.updatedAt.toDate) {
      post.updatedAt = post.updatedAt.toDate().toISOString();
    }

    delete post.authorId;

    res.json({
      success: true,
      data: { post }
    });

  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch post',
      message: error.message
    });
  }
});

// ========== COMMENTS API ==========

// GET /v1/posts/:id/comments - List comments for a post
app.get('/v1/posts/:postId/comments', optionalAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const { page = '1', limit = '20' } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = Math.min(parseInt(limit, 10), 50);
    const offset = (pageNum - 1) * limitNum;

    // Get comments (newest first) - only approved comments
    const query = db.collection('posts').doc(postId)
      .collection('comments')
      .where('moderationStatus', '==', 'approved')
      .orderBy('createdAt', 'desc')
      .offset(offset)
      .limit(limitNum + 1);

    const snapshot = await query.get();
    const comments = [];
    const hasMore = snapshot.docs.length > limitNum;

    const docsToProcess = hasMore ? snapshot.docs.slice(0, limitNum) : snapshot.docs;
    
    for (const doc of docsToProcess) {
      const comment = { id: doc.id, ...doc.data() };
      
      // Get author info
      if (comment.authorId) {
        const authorDoc = await db.collection('users').doc(comment.authorId).get();
        if (authorDoc.exists) {
          const authorData = authorDoc.data();
          comment.author = {
            id: comment.authorId,
            name: comment.isAnonymous ? 'Anonymous' : (authorData.name || 'User'),
            avatarUrl: comment.isAnonymous ? null : (authorData.avatarUrl || null),
            verified: comment.isAnonymous ? false : (authorData.verified || false)
          };
        }
      }

      // Convert timestamps
      if (comment.createdAt && comment.createdAt.toDate) {
        comment.createdAt = comment.createdAt.toDate().toISOString();
      }

      delete comment.authorId;
      comments.push(comment);
    }

    res.json({
      success: true,
      data: {
        comments,
        pagination: {
          currentPage: pageNum,
          hasMore,
          totalShown: comments.length
        }
      }
    });

  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch comments',
      message: error.message
    });
  }
});

// POST /v1/posts/:id/comments - Create comment on post
app.post('/v1/posts/:postId/comments', authenticateUser, async (req, res) => {
  try {
    const { postId } = req.params;
    const { content, isAnonymous = false } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Content is required'
      });
    }

    if (content.length > 2000) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Comment too long. Maximum 2000 characters.'
      });
    }

    // Check if post exists
    const postRef = db.collection('posts').doc(postId);
    const postDoc = await postRef.get();
    
    if (!postDoc.exists) {
      return res.status(404).json({
        error: 'Post not found'
      });
    }

    const now = new Date();
    const commentData = {
      content: content.trim(),
      authorId: req.user.uid,
      isAnonymous: Boolean(isAnonymous),
      createdAt: now,
      likes: 0,
      moderationStatus: 'approved' // Set default moderation status
    };

    // Use transaction to create comment and increment post comment count atomically
    const result = await db.runTransaction(async (transaction) => {
      const commentRef = db.collection('posts').doc(postId).collection('comments').doc();
      
      transaction.set(commentRef, commentData);
      transaction.update(postRef, {
        comments: admin.firestore.FieldValue.increment(1),
        updatedAt: now
      });

      return {
        id: commentRef.id,
        ...commentData
      };
    });

    // Format response
    const createdComment = {
      ...result,
      createdAt: result.createdAt.toISOString(),
      author: {
        id: req.user.uid,
        name: isAnonymous ? 'Anonymous' : req.user.name,
        avatarUrl: isAnonymous ? null : req.user.avatarUrl,
        verified: isAnonymous ? false : req.user.verified
      }
    };

    delete createdComment.authorId;

    res.status(201).json({
      success: true,
      data: { comment: createdComment }
    });

  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create comment',
      message: error.message
    });
  }
});

// POST /v1/posts/:postId/comments/:commentId/like - Toggle like on comment
app.post('/v1/posts/:postId/comments/:commentId/like', authenticateUser, async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const userId = req.user.uid;

    const result = await db.runTransaction(async (transaction) => {
      const commentRef = db.collection('posts').doc(postId).collection('comments').doc(commentId);
      const likeRef = commentRef.collection('likes').doc(userId);
      
      const [commentDoc, likeDoc] = await transaction.getAll(commentRef, likeRef);
      
      if (!commentDoc.exists) {
        throw new Error('Comment not found');
      }

      const isLiked = likeDoc.exists;
      const currentLikes = commentDoc.data().likes || 0;

      if (isLiked) {
        // Unlike
        transaction.delete(likeRef);
        transaction.update(commentRef, { likes: Math.max(0, currentLikes - 1) });
        return { liked: false, likes: Math.max(0, currentLikes - 1) };
      } else {
        // Like
        transaction.set(likeRef, { userId, createdAt: new Date() });
        transaction.update(commentRef, { likes: currentLikes + 1 });
        return { liked: true, likes: currentLikes + 1 };
      }
    });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error toggling comment like:', error);
    res.status(error.message === 'Comment not found' ? 404 : 500).json({
      success: false,
      error: 'Failed to toggle like',
      message: error.message
    });
  }
});

// ========== MODERATION API ==========

// POST /v1/moderation/report - Report content
app.post('/v1/moderation/report', authenticateUser, async (req, res) => {
  try {
    const { contentId, contentType, reason, description = '' } = req.body;

    if (!contentId || !contentType || !reason) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'contentId, contentType, and reason are required'
      });
    }

    if (!['post', 'comment'].includes(contentType)) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'contentType must be "post" or "comment"'
      });
    }

    const validReasons = ['spam', 'harassment', 'inappropriate', 'misinformation', 'other'];
    if (!validReasons.includes(reason)) {
      return res.status(400).json({
        error: 'Validation failed',
        message: `reason must be one of: ${validReasons.join(', ')}`
      });
    }

    // Check for duplicate pending reports by same user
    const existingQuery = db.collection('moderationReports')
      .where('contentId', '==', contentId)
      .where('reporterId', '==', req.user.uid)
      .where('status', '==', 'pending')
      .limit(1);

    const existing = await existingQuery.get();
    if (!existing.empty) {
      return res.status(409).json({
        error: 'Duplicate report',
        message: 'You have already reported this content'
      });
    }

    // Create report with postId for comment moderation
    const reportData = {
      contentId,
      contentType,
      reason,
      description: description.trim(),
      reporterId: req.user.uid,
      reporterName: req.user.name,
      status: 'pending',
      createdAt: new Date(),
      reviewedAt: null,
      reviewedBy: null,
      action: null,
      // For comments, extract postId from the route context if available
      postId: contentType === 'comment' ? req.body.postId || null : null
    };

    const reportRef = await db.collection('moderationReports').add(reportData);

    res.status(201).json({
      success: true,
      data: {
        reportId: reportRef.id,
        message: 'Report submitted successfully'
      }
    });

  } catch (error) {
    console.error('Error creating report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit report',
      message: error.message
    });
  }
});

// GET /v1/moderation/queue - Moderation queue (moderators only)
app.get('/v1/moderation/queue', authenticateUser, async (req, res) => {
  try {
    if (req.user.role !== 'moderator' && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Moderator access required'
      });
    }

    const { status = 'pending', page = '1', limit = '20' } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = Math.min(parseInt(limit, 10), 50);
    const offset = (pageNum - 1) * limitNum;

    let query = db.collection('moderationReports');
    
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      query = query.where('status', '==', status);
    }

    query = query.orderBy('createdAt', 'desc').offset(offset).limit(limitNum + 1);

    const snapshot = await query.get();
    const reports = [];
    const hasMore = snapshot.docs.length > limitNum;

    const docsToProcess = hasMore ? snapshot.docs.slice(0, limitNum) : snapshot.docs;
    
    for (const doc of docsToProcess) {
      const report = { id: doc.id, ...doc.data() };
      
      // Convert timestamps
      if (report.createdAt && report.createdAt.toDate) {
        report.createdAt = report.createdAt.toDate().toISOString();
      }
      if (report.reviewedAt && report.reviewedAt.toDate) {
        report.reviewedAt = report.reviewedAt.toDate().toISOString();
      }
      
      reports.push(report);
    }

    res.json({
      success: true,
      data: {
        reports,
        pagination: {
          currentPage: pageNum,
          hasMore,
          totalShown: reports.length
        }
      }
    });

  } catch (error) {
    console.error('Error fetching moderation queue:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch moderation queue',
      message: error.message
    });
  }
});

// PUT /v1/moderation/review/:reportId - Review moderation report
app.put('/v1/moderation/review/:reportId', authenticateUser, async (req, res) => {
  try {
    if (req.user.role !== 'moderator' && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Moderator access required'
      });
    }

    const { reportId } = req.params;
    const { action } = req.body;

    if (!['approve', 'remove', 'ban'].includes(action)) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'action must be "approve", "remove", or "ban"'
      });
    }

    await db.runTransaction(async (transaction) => {
      const reportRef = db.collection('moderationReports').doc(reportId);
      const reportDoc = await transaction.get(reportRef);
      
      if (!reportDoc.exists) {
        throw new Error('Report not found');
      }

      const reportData = reportDoc.data();
      
      // Update report
      transaction.update(reportRef, {
        status: action === 'approve' ? 'approved' : 'reviewed',
        action,
        reviewedAt: new Date(),
        reviewedBy: req.user.uid
      });

      // Update target content based on action
      if (action === 'remove' || action === 'ban') {
        if (reportData.contentType === 'post') {
          const postRef = db.collection('posts').doc(reportData.contentId);
          transaction.update(postRef, {
            moderationStatus: 'removed',
            updatedAt: new Date()
          });
        } else if (reportData.contentType === 'comment') {
          // For comments, we need to parse the contentId to get post and comment IDs
          // Format expected: "postId/comments/commentId" or store separately
          // For now, mark comment as removed (requires postId to be stored in report)
          if (reportData.postId) {
            const commentRef = db.collection('posts').doc(reportData.postId)
              .collection('comments').doc(reportData.contentId);
            transaction.update(commentRef, {
              moderationStatus: 'removed',
              updatedAt: new Date()
            });
          }
        }
      }
    });

    res.json({
      success: true,
      data: {
        message: `Report ${action}d successfully`
      }
    });

  } catch (error) {
    console.error('Error reviewing report:', error);
    res.status(error.message === 'Report not found' ? 404 : 500).json({
      success: false,
      error: 'Failed to review report',
      message: error.message
    });
  }
});

// 404 handler  
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    timestamp: new Date().toISOString(),
    availableEndpoints: [
      'GET /v1/health',
      'GET /v1/posts',
      'POST /v1/posts',
      'POST /v1/posts/:id/like',
      'GET /v1/posts/:id',
      'GET /v1/posts/:postId/comments',
      'POST /v1/posts/:postId/comments',
      'POST /v1/posts/:postId/comments/:commentId/like',
      'POST /v1/moderation/report',
      'GET /v1/moderation/queue',
      'PUT /v1/moderation/review/:reportId'
    ]
  });
});

const PORT = process.env.PORT || 5000;

console.log(`🚀 Starting Simple Femina Backend Server on port ${PORT}`);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Femina Backend is running on http://0.0.0.0:${PORT}`);
  console.log(`📋 Available endpoints:`);
  console.log(`   GET  /v1/health - Health check`);
  console.log(`   GET  /v1/test - API test`);
  console.log(`   GET  /v1/resources - Sample resources`);
  console.log(`🌐 Backend ready for frontend connection!`);
});