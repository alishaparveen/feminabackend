/**
 * Posts Routes for Femina Platform
 * Handles community posts, comments, likes, and interactions
 */

import { Router, Response } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { validateRequest } from '../middleware/validation';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();
const db = getFirestore();

// Validation schemas
const createPostSchema = z.object({
  content: z.string().min(1).max(5000),
  category: z.enum(['general', 'health', 'career', 'relationships', 'parenting', 'lifestyle', 'support']),
  tags: z.array(z.string()).max(10).optional(),
  images: z.array(z.string().url()).max(5).optional(),
  isAnonymous: z.boolean().default(false),
  allowComments: z.boolean().default(true)
});

const updatePostSchema = z.object({
  content: z.string().min(1).max(5000).optional(),
  tags: z.array(z.string()).max(10).optional(),
  allowComments: z.boolean().optional()
});

const createCommentSchema = z.object({
  content: z.string().min(1).max(1000),
  isAnonymous: z.boolean().default(false),
  parentCommentId: z.string().optional() // For reply threads
});

/**
 * GET /api/posts
 * Get posts with filtering and pagination
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      tags,
      author,
      sortBy = 'recent',
      timeframe = '7d'
    } = req.query;

    let query: any = db.collection('posts');

    // Apply filters
    if (category) {
      query = query.where('category', '==', category);
    }

    if (author) {
      query = query.where('authorId', '==', author);
    }

    // Filter by timeframe
    if (timeframe && timeframe !== 'all') {
      const timeframeDays = timeframe === '24h' ? 1 : 
        timeframe === '7d' ? 7 : 
          timeframe === '30d' ? 30 : null;
      if (timeframeDays) {
        const startDate = new Date(Date.now() - timeframeDays * 24 * 60 * 60 * 1000);
        query = query.where('createdAt', '>=', startDate);
      }
    }

    // Filter out removed content
    query = query.where('moderationStatus', 'not-in', ['removed', 'pending']);

    // Apply sorting
    switch (sortBy) {
    case 'popular':
      query = query.orderBy('likes', 'desc');
      break;
    case 'discussed':
      query = query.orderBy('comments', 'desc');
      break;
    case 'recent':
    default:
      query = query.orderBy('createdAt', 'desc');
      break;
    }

    // Apply pagination
    const offset = (Number(page) - 1) * Number(limit);
    query = query.offset(offset).limit(Number(limit));

    const querySnapshot = await query.get();
    let posts = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Apply client-side tag filtering if specified
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      posts = posts.filter(post =>
        Array.isArray((post as any).tags) &&
        (post as any).tags.some((tag: string) => tagArray.includes(tag))
      );
    }

    // Get author information for posts
    const authorIds = [
      ...new Set(
        posts
          .map(post => (post as any).authorId)
          .filter((id): id is string => typeof id === 'string')
      )
    ];
    const authorsSnapshot = authorIds.length
      ? await db.collection('users')
        .where('uid', 'in', authorIds.slice(0, 10)) // Firestore limit
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

    // Enrich posts with author data and user interaction status
    const userId = req.user!.uid;
    const enrichedPosts = await Promise.all(
      posts.map(async (post: any) => {
        const authorData = authorsMap.get((post as any).authorId);

        // Check if user liked this post
        const userLiked = Array.isArray(post.likedBy) ? post.likedBy.includes(userId) : false;
        // Check if user bookmarked this post
        const bookmarkQuery = await db.collection('bookmarks')
          .where('userId', '==', userId)
          .where('itemId', '==', post.id)
          .where('itemType', '==', 'post')
          .limit(1)
          .get();
        const userBookmarked = !bookmarkQuery.empty;

        return {
          ...post,
          author: post.isAnonymous ? {
            displayName: 'Anonymous',
            photoURL: null,
            verified: false
          } : (authorData || null),
          userLiked,
          userBookmarked,
          // Remove sensitive data
          likedBy: undefined,
          reportedBy: undefined,
          moderationNotes: undefined
        };
      })
    );

    res.json({
      success: true,
      data: {
        posts: enrichedPosts,
        pagination: {
          currentPage: Number(page),
          hasMore: querySnapshot.size === Number(limit),
          totalShown: enrichedPosts.length
        },
        filters: {
          category: category || 'all',
          tags: tags || 'all',
          sortBy,
          timeframe
        }
      }
    });

  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({
      error: 'Database Error',
      message: 'Failed to fetch posts'
    });
  }
});

/**
 * POST /api/posts
 * Create a new post
 */
router.post('/', validateRequest(createPostSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;
    const postData = req.body;

    // Get user information
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    if (!userData) {
      return res.status(404).json({
        error: 'User Not Found',
        message: 'User profile not found'
      });
    }

    // Check if user is suspended
    if (userData.suspended && userData.suspendedUntil > new Date()) {
      return res.status(403).json({
        error: 'Account Suspended',
        message: 'Your account is currently suspended'
      });
    }

    const postId = db.collection('posts').doc().id;
    const now = new Date();

    const newPost = {
      id: postId,
      authorId: userId,
      authorRole: userData.role || 'user',
      content: postData.content,
      category: postData.category,
      tags: postData.tags || [],
      images: postData.images || [],
      isAnonymous: postData.isAnonymous,
      allowComments: postData.allowComments,
      likes: 0,
      comments: 0,
      shares: 0,
      views: 0,
      likedBy: [],
      createdAt: now,
      updatedAt: now,
      moderationStatus: 'approved', // Auto-approve for now
      flaggedForReview: false
    };

    await db.collection('posts').doc(postId).set(newPost);

    // Update user's post count
    await db.collection('users').doc(userId).update({
      postCount: FieldValue.increment(1),
      lastPostAt: now,
      lastActive: now
    });

    // Log activity
    await db.collection('userActivity').add({
      userId,
      action: 'post_created',
      postId,
      timestamp: now,
      metadata: {
        category: postData.category,
        isAnonymous: postData.isAnonymous
      }
    });

    res.status(201).json({
      success: true,
      data: {
        postId,
        message: 'Post created successfully'
      }
    });

  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({
      error: 'Create Error',
      message: 'Failed to create post'
    });
  }
});

/**
 * GET /api/posts/:postId
 * Get a specific post with comments
 */
router.get('/:postId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId } = req.params;
    const userId = req.user!.uid;

    const postDoc = await db.collection('posts').doc(postId).get();
    
    if (!postDoc.exists) {
      return res.status(404).json({
        error: 'Post Not Found',
        message: 'Post not found'
      });
    }

    const postData = postDoc.data()!;

    // Check if post is removed and user doesn't own it
    if (postData.moderationStatus === 'removed' && postData.authorId !== userId) {
      return res.status(404).json({
        error: 'Post Not Available',
        message: 'This post is not available'
      });
    }

    // Get author information
    const authorDoc = await db.collection('users').doc(postData.authorId).get();
    const authorData = authorDoc.data();

    // Get comments
    const commentsQuery = await db.collection('posts').doc(postId)
      .collection('comments')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const comments = await Promise.all(
      commentsQuery.docs.map(async (commentDoc) => {
        const comment = commentDoc.data();
        
        // Get comment author info
        let commentAuthor = null;
        if (!comment.isAnonymous && comment.authorId) {
          const commentAuthorDoc = await db.collection('users').doc(comment.authorId).get();
          const commentAuthorData = commentAuthorDoc.data();
          commentAuthor = {
            uid: commentAuthorData?.uid,
            displayName: commentAuthorData?.displayName,
            photoURL: commentAuthorData?.photoURL,
            role: commentAuthorData?.role,
            verified: commentAuthorData?.verified
          };
        }

        return {
          id: commentDoc.id,
          ...comment,
          author: comment.isAnonymous ? {
            displayName: 'Anonymous',
            photoURL: null,
            verified: false
          } : commentAuthor
        };
      })
    );

    // Increment view count
    await postDoc.ref.update({
      views: FieldValue.increment(1)
    });

    // Check user interactions
    const userLiked = postData.likedBy?.includes(userId) || false;
    const bookmarkQuery = await db.collection('bookmarks')
      .where('userId', '==', userId)
      .where('itemId', '==', postId)
      .where('itemType', '==', 'post')
      .limit(1)
      .get();
    const userBookmarked = !bookmarkQuery.empty;

    const enrichedPost = {
      id: postId,
      ...postData,
      author: postData.isAnonymous ? {
        displayName: 'Anonymous',
        photoURL: null,
        verified: false
      } : {
        uid: authorData?.uid,
        displayName: authorData?.displayName,
        photoURL: authorData?.photoURL,
        role: authorData?.role,
        verified: authorData?.verified
      },
      comments,
      userLiked,
      userBookmarked,
      // Remove sensitive data
      likedBy: undefined,
      reportedBy: undefined,
      moderationNotes: undefined
    };

    res.json({
      success: true,
      data: enrichedPost
    });

  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({
      error: 'Database Error',
      message: 'Failed to fetch post'
    });
  }
});

/**
 * PUT /api/posts/:postId
 * Update a post (author only)
 */
router.put('/:postId', validateRequest(updatePostSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId } = req.params;
    const userId = req.user!.uid;
    const updateData = req.body;

    const postDoc = await db.collection('posts').doc(postId).get();
    
    if (!postDoc.exists) {
      return res.status(404).json({
        error: 'Post Not Found',
        message: 'Post not found'
      });
    }

    const postData = postDoc.data()!;

    // Check ownership
    if (postData.authorId !== userId) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'You can only edit your own posts'
      });
    }

    // Update post
    updateData.updatedAt = new Date();
    updateData.editedAt = new Date();

    await postDoc.ref.update(updateData);

    // Log activity
    await db.collection('userActivity').add({
      userId,
      action: 'post_updated',
      postId,
      timestamp: new Date(),
      metadata: {
        changes: Object.keys(updateData)
      }
    });

    res.json({
      success: true,
      message: 'Post updated successfully'
    });

  } catch (error) {
    console.error('Error updating post:', error);
    res.status(500).json({
      error: 'Update Error',
      message: 'Failed to update post'
    });
  }
});

/**
 * DELETE /api/posts/:postId
 * Delete a post (author or admin only)
 */
router.delete('/:postId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId } = req.params;
    const userId = req.user!.uid;

    const postDoc = await db.collection('posts').doc(postId).get();
    
    if (!postDoc.exists) {
      return res.status(404).json({
        error: 'Post Not Found',
        message: 'Post not found'
      });
    }

    const postData = postDoc.data()!;

    // Check ownership or admin privileges
    const userDoc = await db.collection('users').doc(userId).get();
    const isAdmin = userDoc.data()?.role === 'admin';

    if (postData.authorId !== userId && !isAdmin) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'You can only delete your own posts'
      });
    }

    // Soft delete - mark as deleted rather than removing
    await postDoc.ref.update({
      deleted: true,
      deletedAt: new Date(),
      deletedBy: userId,
      moderationStatus: 'removed'
    });

    // Update user's post count
    await db.collection('users').doc(postData.authorId).update({
      postCount: FieldValue.increment(-1)
    });

    // Log activity
    await db.collection('userActivity').add({
      userId,
      action: 'post_deleted',
      postId,
      timestamp: new Date(),
      metadata: {
        deletedBy: userId,
        wasOwner: postData.authorId === userId
      }
    });

    res.json({
      success: true,
      message: 'Post deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({
      error: 'Delete Error',
      message: 'Failed to delete post'
    });
  }
});

/**
 * POST /api/posts/:postId/like
 * Like or unlike a post
 */
router.post('/:postId/like', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId } = req.params;
    const userId = req.user!.uid;

    const postDoc = await db.collection('posts').doc(postId).get();
    
    if (!postDoc.exists) {
      return res.status(404).json({
        error: 'Post Not Found',
        message: 'Post not found'
      });
    }

    const postData = postDoc.data()!;
    const likedBy = postData.likedBy || [];
    const userHasLiked = likedBy.includes(userId);

    let updateData: any;
    let action: string;

    if (userHasLiked) {
      // Unlike the post
      updateData = {
        likedBy: FieldValue.arrayRemove(userId),
        likes: FieldValue.increment(-1)
      };
      action = 'unliked';
    } else {
      // Like the post
      updateData = {
        likedBy: FieldValue.arrayUnion(userId),
        likes: FieldValue.increment(1)
      };
      action = 'liked';

      // Create notification for post author (if not liking own post)
      if (postData.authorId !== userId) {
        await db.collection('notifications').add({
          userId: postData.authorId,
          type: 'post_liked',
          title: 'Post Liked',
          message: `Someone ${postData.isAnonymous ? '' : 'liked your post'}`,
          postId,
          actionUserId: userId,
          createdAt: new Date(),
          read: false
        });
      }
    }

    await postDoc.ref.update(updateData);

    // Log activity
    await db.collection('userActivity').add({
      userId,
      action: `post_${action}`,
      postId,
      timestamp: new Date()
    });

    res.json({
      success: true,
      data: {
        liked: !userHasLiked,
        likes: postData.likes + (userHasLiked ? -1 : 1)
      }
    });

  } catch (error) {
    console.error('Error toggling like:', error);
    res.status(500).json({
      error: 'Like Error',
      message: 'Failed to update like status'
    });
  }
});

/**
 * POST /api/posts/:postId/bookmark
 * Bookmark or unbookmark a post
 */
router.post('/:postId/bookmark', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId } = req.params;
    const userId = req.user!.uid;

    // Check if post exists
    const postDoc = await db.collection('posts').doc(postId).get();
    if (!postDoc.exists) {
      return res.status(404).json({
        error: 'Post Not Found',
        message: 'Post not found'
      });
    }

    // Check if already bookmarked
    const existingBookmark = await db.collection('bookmarks')
      .where('userId', '==', userId)
      .where('itemId', '==', postId)
      .where('itemType', '==', 'post')
      .limit(1)
      .get();

    let bookmarked: boolean;

    if (existingBookmark.empty) {
      // Create bookmark
      await db.collection('bookmarks').add({
        userId,
        itemId: postId,
        itemType: 'post',
        createdAt: new Date()
      });
      bookmarked = true;
    } else {
      // Remove bookmark
      await existingBookmark.docs[0].ref.delete();
      bookmarked = false;
    }

    // Log activity
    await db.collection('userActivity').add({
      userId,
      action: bookmarked ? 'post_bookmarked' : 'post_unbookmarked',
      postId,
      timestamp: new Date()
    });

    res.json({
      success: true,
      data: { bookmarked }
    });

  } catch (error) {
    console.error('Error toggling bookmark:', error);
    res.status(500).json({
      error: 'Bookmark Error',
      message: 'Failed to update bookmark status'
    });
  }
});

/**
 * POST /api/posts/:postId/share
 * Share a post (increment share count)
 */
router.post('/:postId/share', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId } = req.params;
    const userId = req.user!.uid;
    const { platform } = req.body;

    const postDoc = await db.collection('posts').doc(postId).get();
    
    if (!postDoc.exists) {
      return res.status(404).json({
        error: 'Post Not Found',
        message: 'Post not found'
      });
    }

    // Increment share count
    await postDoc.ref.update({
      shares: FieldValue.increment(1)
    });

    // Log share activity
    await db.collection('userActivity').add({
      userId,
      action: 'post_shared',
      postId,
      timestamp: new Date(),
      metadata: {
        platform: platform || 'unknown'
      }
    });

    res.json({
      success: true,
      message: 'Share recorded successfully'
    });

  } catch (error) {
    console.error('Error recording share:', error);
    res.status(500).json({
      error: 'Share Error',
      message: 'Failed to record share'
    });
  }
});

/**
 * GET /api/posts/:postId/comments
 * Get comments for a post
 */
router.get('/:postId/comments', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId } = req.params;
    const { limit = 50, page = 1, sortBy = 'recent' } = req.query;

    // Check if post exists
    const postDoc = await db.collection('posts').doc(postId).get();
    if (!postDoc.exists) {
      return res.status(404).json({
        error: 'Post Not Found',
        message: 'Post not found'
      });
    }

    let query: any = db.collection('posts').doc(postId).collection('comments');

    // Apply sorting
    if (sortBy === 'popular') {
      query = query.orderBy('likes', 'desc');
    } else {
      query = query.orderBy('createdAt', 'desc');
    }

    // Apply pagination
    const offset = (Number(page) - 1) * Number(limit);
    query = query.offset(offset).limit(Number(limit));

    const querySnapshot = await query.get();
    
    const comments = await Promise.all(
      querySnapshot.docs.map(async (commentDoc) => {
        const comment = commentDoc.data();
        
        // Get comment author info
        let author = null;
        if (!comment.isAnonymous && comment.authorId) {
          const authorDoc = await db.collection('users').doc(comment.authorId).get();
          const authorData = authorDoc.data();
          author = {
            uid: authorData?.uid,
            displayName: authorData?.displayName,
            photoURL: authorData?.photoURL,
            role: authorData?.role,
            verified: authorData?.verified
          };
        }

        return {
          id: commentDoc.id,
          ...comment,
          author: comment.isAnonymous ? {
            displayName: 'Anonymous',
            photoURL: null,
            verified: false
          } : author
        };
      })
    );

    res.json({
      success: true,
      data: {
        comments,
        pagination: {
          currentPage: Number(page),
          hasMore: querySnapshot.size === Number(limit)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({
      error: 'Database Error',
      message: 'Failed to fetch comments'
    });
  }
});

/**
 * POST /api/posts/:postId/comments
 * Add a comment to a post
 */
router.post('/:postId/comments', validateRequest(createCommentSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId } = req.params;
    const userId = req.user!.uid;
    const { content, isAnonymous, parentCommentId } = req.body;

    const postDoc = await db.collection('posts').doc(postId).get();
    
    if (!postDoc.exists) {
      return res.status(404).json({
        error: 'Post Not Found',
        message: 'Post not found'
      });
    }

    const postData = postDoc.data()!;

    // Check if comments are allowed
    if (!postData.allowComments) {
      return res.status(403).json({
        error: 'Comments Disabled',
        message: 'Comments are not allowed on this post'
      });
    }

    // Get user information
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    if (!userData) {
      return res.status(404).json({
        error: 'User Not Found',
        message: 'User profile not found'
      });
    }

    // Check if user is suspended
    if (userData.suspended && userData.suspendedUntil > new Date()) {
      return res.status(403).json({
        error: 'Account Suspended',
        message: 'Your account is currently suspended'
      });
    }

    const commentId = db.collection('posts').doc(postId).collection('comments').doc().id;
    const now = new Date();

    const newComment = {
      id: commentId,
      authorId: userId,
      authorRole: userData.role || 'user',
      content,
      isAnonymous,
      parentCommentId: parentCommentId || null,
      likes: 0,
      replies: 0,
      likedBy: [],
      createdAt: now,
      updatedAt: now,
      moderationStatus: 'approved'
    };

    await db.collection('posts').doc(postId).collection('comments').doc(commentId).set(newComment);

    // Update post comment count
    await postDoc.ref.update({
      comments: FieldValue.increment(1)
    });

    // If this is a reply, update parent comment reply count
    if (parentCommentId) {
      await db.collection('posts').doc(postId).collection('comments').doc(parentCommentId).update({
        replies: FieldValue.increment(1)
      });
    }

    // Create notification for post author (if not commenting on own post)
    if (postData.authorId !== userId) {
      await db.collection('notifications').add({
        userId: postData.authorId,
        type: 'post_commented',
        title: 'New Comment',
        message: 'Someone commented on your post',
        postId,
        commentId,
        actionUserId: userId,
        createdAt: now,
        read: false
      });
    }

    // Log activity
    await db.collection('userActivity').add({
      userId,
      action: 'comment_created',
      postId,
      commentId,
      timestamp: now,
      metadata: {
        isAnonymous,
        isReply: !!parentCommentId
      }
    });

    res.status(201).json({
      success: true,
      data: {
        commentId,
        message: 'Comment added successfully'
      }
    });

  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({
      error: 'Create Error',
      message: 'Failed to create comment'
    });
  }
});

/**
 * PUT /api/posts/:postId/comments/:commentId
 * Update a comment (author only)
 */
router.put('/:postId/comments/:commentId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId, commentId } = req.params;
    const userId = req.user!.uid;
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        error: 'Invalid Content',
        message: 'Comment content cannot be empty'
      });
    }

    const commentDoc = await db.collection('posts').doc(postId).collection('comments').doc(commentId).get();
    
    if (!commentDoc.exists) {
      return res.status(404).json({
        error: 'Comment Not Found',
        message: 'Comment not found'
      });
    }

    const commentData = commentDoc.data()!;

    // Check ownership
    if (commentData.authorId !== userId) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'You can only edit your own comments'
      });
    }

    await commentDoc.ref.update({
      content: content.trim(),
      updatedAt: new Date(),
      editedAt: new Date()
    });

    // Log activity
    await db.collection('userActivity').add({
      userId,
      action: 'comment_updated',
      postId,
      commentId,
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: 'Comment updated successfully'
    });

  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({
      error: 'Update Error',
      message: 'Failed to update comment'
    });
  }
});

/**
 * DELETE /api/posts/:postId/comments/:commentId
 * Delete a comment (author or admin only)
 */
router.delete('/:postId/comments/:commentId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId, commentId } = req.params;
    const userId = req.user!.uid;

    const commentDoc = await db.collection('posts').doc(postId).collection('comments').doc(commentId).get();
    
    if (!commentDoc.exists) {
      return res.status(404).json({
        error: 'Comment Not Found',
        message: 'Comment not found'
      });
    }

    const commentData = commentDoc.data()!;

    // Check ownership or admin privileges
    const userDoc = await db.collection('users').doc(userId).get();
    const isAdmin = userDoc.data()?.role === 'admin';

    if (commentData.authorId !== userId && !isAdmin) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'You can only delete your own comments'
      });
    }

    // Soft delete - mark as deleted
    await commentDoc.ref.update({
      deleted: true,
      deletedAt: new Date(),
      deletedBy: userId,
      content: '[deleted]'
    });

    // Update post comment count
    await db.collection('posts').doc(postId).update({
      comments: FieldValue.increment(-1)
    });

    // Log activity
    await db.collection('userActivity').add({
      userId,
      action: 'comment_deleted',
      postId,
      commentId,
      timestamp: new Date(),
      metadata: {
        deletedBy: userId,
        wasOwner: commentData.authorId === userId
      }
    });

    res.json({
      success: true,
      message: 'Comment deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({
      error: 'Delete Error',
      message: 'Failed to delete comment'
    });
  }
});

/**
 * POST /api/posts/:postId/comments/:commentId/like
 * Like or unlike a comment
 */
router.post('/:postId/comments/:commentId/like', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { postId, commentId } = req.params;
    const userId = req.user!.uid;

    const commentDoc = await db.collection('posts').doc(postId).collection('comments').doc(commentId).get();
    
    if (!commentDoc.exists) {
      return res.status(404).json({
        error: 'Comment Not Found',
        message: 'Comment not found'
      });
    }

    const commentData = commentDoc.data()!;
    const likedBy = commentData.likedBy || [];
    const userHasLiked = likedBy.includes(userId);

    let updateData: any;
    let action: string;

    if (userHasLiked) {
      // Unlike the comment
      updateData = {
        likedBy: FieldValue.arrayRemove(userId),
        likes: FieldValue.increment(-1)
      };
      action = 'unliked';
    } else {
      // Like the comment
      updateData = {
        likedBy: FieldValue.arrayUnion(userId),
        likes: FieldValue.increment(1)
      };
      action = 'liked';

      // Create notification for comment author (if not liking own comment)
      if (commentData.authorId !== userId) {
        await db.collection('notifications').add({
          userId: commentData.authorId,
          type: 'comment_liked',
          title: 'Comment Liked',
          message: 'Someone liked your comment',
          postId,
          commentId,
          actionUserId: userId,
          createdAt: new Date(),
          read: false
        });
      }
    }

    await commentDoc.ref.update(updateData);

    // Log activity
    await db.collection('userActivity').add({
      userId,
      action: `comment_${action}`,
      postId,
      commentId,
      timestamp: new Date()
    });

    res.json({
      success: true,
      data: {
        liked: !userHasLiked,
        likes: commentData.likes + (userHasLiked ? -1 : 1)
      }
    });

  } catch (error) {
    console.error('Error toggling comment like:', error);
    res.status(500).json({
      error: 'Like Error',
      message: 'Failed to update like status'
    });
  }
});

export { router as postsRoutes };