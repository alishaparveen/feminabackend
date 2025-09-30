const admin = require('firebase-admin');
const db = admin.firestore();

const createStory = async (req, res) => {
  try {
    const { title, excerpt, content, tags = [], imageUrl = null, audioUrl = null, audioDuration = 0, visibility = 'public' } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'Title and content are required'
      });
    }

    const storyData = {
      title: title.trim(),
      excerpt: excerpt ? excerpt.trim() : content.substring(0, 150) + '...',
      content,
      tags: Array.isArray(tags) ? tags.map(tag => tag.toLowerCase().trim()) : [],
      authorId: req.user.uid,
      authorName: req.user.name,
      authorAvatar: req.user.avatarUrl,
      imageUrl,
      audioUrl,
      audioDuration,
      visibility,
      likesCount: 0,
      views: 0,
      commentsCount: 0,
      savedBy: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      moderation: {
        status: 'pending',
        notes: ''
      }
    };

    const storyRef = await db.collection('stories').add(storyData);
    const newStory = await storyRef.get();
    const data = newStory.data();

    res.status(201).json({
      success: true,
      data: {
        story: {
          id: storyRef.id,
          title: data.title,
          excerpt: data.excerpt,
          content: data.content,
          tags: data.tags,
          authorId: data.authorId,
          authorName: data.authorName,
          authorAvatar: data.authorAvatar,
          imageUrl: data.imageUrl,
          audioUrl: data.audioUrl,
          audioDuration: data.audioDuration,
          visibility: data.visibility,
          likesCount: data.likesCount,
          views: data.views,
          commentsCount: data.commentsCount,
          createdAt: data.createdAt?.toDate()?.toISOString(),
          updatedAt: data.updatedAt?.toDate()?.toISOString(),
          moderationStatus: data.moderation?.status
        }
      },
      message: 'Story created successfully'
    });

  } catch (error) {
    console.error('Error creating story:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create story',
      message: error.message
    });
  }
};

const getStories = async (req, res) => {
  try {
    const { 
      q = '', 
      tags = '', 
      authorId = '', 
      type = 'public',
      sort = 'newest', 
      page = '1', 
      limit = '20' 
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = Math.min(parseInt(limit, 10), 50);
    const offset = (pageNum - 1) * limitNum;

    let query = db.collection('stories');

    const isStaff = req.user && (req.user.role === 'moderator' || req.user.role === 'admin');
    const isOwnStories = authorId && req.user && authorId === req.user.uid;

    if (authorId) {
      query = query.where('authorId', '==', authorId);
    }

    if (tags) {
      const tagArray = tags.split(',').map(t => t.toLowerCase().trim());
      query = query.where('tags', 'array-contains-any', tagArray);
    }

    if (!isStaff && !isOwnStories) {
      query = query.where('moderation.status', '==', 'approved');
      query = query.where('visibility', '==', 'public');
    } else if (isOwnStories) {
      if (type === 'public') {
        query = query.where('visibility', '==', 'public');
      }
    }

    switch (sort) {
      case 'top':
        query = query.orderBy('likesCount', 'desc').orderBy('views', 'desc');
        break;
      case 'most_commented':
        query = query.orderBy('commentsCount', 'desc');
        break;
      case 'newest':
      default:
        query = query.orderBy('createdAt', 'desc');
        break;
    }

    query = query.offset(offset).limit(limitNum + 1);

    const snapshot = await query.get();
    const hasMore = snapshot.docs.length > limitNum;
    const docsToProcess = hasMore ? snapshot.docs.slice(0, limitNum) : snapshot.docs;

    let stories = docsToProcess.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title,
        excerpt: data.excerpt,
        content: data.content,
        tags: data.tags,
        authorId: data.authorId,
        authorName: data.authorName,
        authorAvatar: data.authorAvatar,
        imageUrl: data.imageUrl,
        audioUrl: data.audioUrl,
        audioDuration: data.audioDuration,
        visibility: data.visibility,
        likesCount: data.likesCount,
        views: data.views,
        commentsCount: data.commentsCount,
        createdAt: data.createdAt?.toDate()?.toISOString(),
        updatedAt: data.updatedAt?.toDate()?.toISOString(),
        moderationStatus: data.moderation?.status
      };
    });

    if (q) {
      const searchLower = q.toLowerCase();
      stories = stories.filter(story => 
        story.title.toLowerCase().includes(searchLower) ||
        story.excerpt.toLowerCase().includes(searchLower)
      );
    }

    res.json({
      success: true,
      data: {
        stories,
        pagination: {
          page: pageNum,
          limit: limitNum,
          hasMore,
          total: stories.length
        }
      }
    });

  } catch (error) {
    console.error('Error fetching stories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stories',
      message: error.message
    });
  }
};

const getStoryById = async (req, res) => {
  try {
    const { id } = req.params;
    const storyDoc = await db.collection('stories').doc(id).get();

    if (!storyDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Story not found',
        message: 'The requested story does not exist'
      });
    }

    const storyData = storyDoc.data();
    
    const isAuthor = req.user && req.user.uid === storyData.authorId;
    const isStaff = req.user && (req.user.role === 'moderator' || req.user.role === 'admin');
    
    if (!isAuthor && !isStaff) {
      if (storyData.moderation?.status !== 'approved' || storyData.visibility !== 'public') {
        return res.status(404).json({
          success: false,
          error: 'Story not found',
          message: 'The requested story does not exist'
        });
      }
    }

    const story = {
      id: storyDoc.id,
      title: storyData.title,
      excerpt: storyData.excerpt,
      content: storyData.content,
      tags: storyData.tags,
      authorId: storyData.authorId,
      authorName: storyData.authorName,
      authorAvatar: storyData.authorAvatar,
      imageUrl: storyData.imageUrl,
      audioUrl: storyData.audioUrl,
      audioDuration: storyData.audioDuration,
      visibility: storyData.visibility,
      likesCount: storyData.likesCount,
      views: storyData.views,
      commentsCount: storyData.commentsCount,
      createdAt: storyData.createdAt?.toDate()?.toISOString(),
      updatedAt: storyData.updatedAt?.toDate()?.toISOString(),
      moderationStatus: storyData.moderation?.status
    };

    if (req.user) {
      const likeDoc = await db.collection('stories').doc(id).collection('likes').doc(req.user.uid).get();
      story.isLiked = likeDoc.exists;
      story.isSaved = storyData.savedBy?.includes(req.user.uid) || false;

      const userDoc = await db.collection('users').doc(req.user.uid).get();
      const userData = userDoc.data() || {};
      story.isFollowingAuthor = userData.following?.includes(storyData.authorId) || false;
    }

    res.json({
      success: true,
      data: { story }
    });

  } catch (error) {
    console.error('Error fetching story:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch story',
      message: error.message
    });
  }
};

const updateStory = async (req, res) => {
  try {
    const { id } = req.params;
    const storyDoc = await db.collection('stories').doc(id).get();

    if (!storyDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Story not found',
        message: 'The requested story does not exist'
      });
    }

    const storyData = storyDoc.data();

    if (storyData.authorId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized',
        message: 'Only the author can update this story'
      });
    }

    const { title, excerpt, content, tags, imageUrl, audioUrl, audioDuration, visibility } = req.body;

    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (title !== undefined) updateData.title = title.trim();
    if (excerpt !== undefined) updateData.excerpt = excerpt.trim();
    if (content !== undefined) updateData.content = content;
    if (tags !== undefined) updateData.tags = Array.isArray(tags) ? tags.map(tag => tag.toLowerCase().trim()) : [];
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
    if (audioUrl !== undefined) updateData.audioUrl = audioUrl;
    if (audioDuration !== undefined) updateData.audioDuration = audioDuration;
    if (visibility !== undefined) updateData.visibility = visibility;

    await db.collection('stories').doc(id).update(updateData);

    const updatedDoc = await db.collection('stories').doc(id).get();
    const data = updatedDoc.data();

    res.json({
      success: true,
      data: {
        story: {
          id: updatedDoc.id,
          title: data.title,
          excerpt: data.excerpt,
          content: data.content,
          tags: data.tags,
          authorId: data.authorId,
          authorName: data.authorName,
          authorAvatar: data.authorAvatar,
          imageUrl: data.imageUrl,
          audioUrl: data.audioUrl,
          audioDuration: data.audioDuration,
          visibility: data.visibility,
          likesCount: data.likesCount,
          views: data.views,
          commentsCount: data.commentsCount,
          createdAt: data.createdAt?.toDate()?.toISOString(),
          updatedAt: data.updatedAt?.toDate()?.toISOString(),
          moderationStatus: data.moderation?.status
        }
      },
      message: 'Story updated successfully'
    });

  } catch (error) {
    console.error('Error updating story:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update story',
      message: error.message
    });
  }
};

const deleteStory = async (req, res) => {
  try {
    const { id } = req.params;
    const storyDoc = await db.collection('stories').doc(id).get();

    if (!storyDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Story not found',
        message: 'The requested story does not exist'
      });
    }

    const storyData = storyDoc.data();

    if (storyData.authorId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized',
        message: 'Only the author can delete this story'
      });
    }

    await db.collection('stories').doc(id).delete();

    res.json({
      success: true,
      message: 'Story deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting story:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete story',
      message: error.message
    });
  }
};

const toggleLike = async (req, res) => {
  try {
    const { id } = req.params;
    const storyRef = db.collection('stories').doc(id);
    const likeRef = storyRef.collection('likes').doc(req.user.uid);

    const storyDoc = await storyRef.get();
    
    if (!storyDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Story not found',
        message: 'The requested story does not exist'
      });
    }

    const storyData = storyDoc.data();
    const isAuthor = req.user.uid === storyData.authorId;
    const isStaff = req.user.role === 'moderator' || req.user.role === 'admin';

    if (!isAuthor && !isStaff) {
      if (storyData.moderation?.status !== 'approved' || storyData.visibility !== 'public') {
        return res.status(404).json({
          success: false,
          error: 'Story not found',
          message: 'The requested story does not exist'
        });
      }
    }

    const result = await db.runTransaction(async (transaction) => {
      const storyDoc = await transaction.get(storyRef);
      const likeDoc = await transaction.get(likeRef);

      if (!storyDoc.exists) {
        throw new Error('Story not found');
      }

      let isLiked;
      const currentLikesCount = storyDoc.data().likesCount || 0;

      if (likeDoc.exists) {
        transaction.delete(likeRef);
        transaction.update(storyRef, {
          likesCount: Math.max(0, currentLikesCount - 1)
        });
        isLiked = false;
      } else {
        transaction.set(likeRef, {
          userId: req.user.uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        transaction.update(storyRef, {
          likesCount: currentLikesCount + 1
        });
        isLiked = true;
      }

      return { isLiked, likesCount: isLiked ? currentLikesCount + 1 : Math.max(0, currentLikesCount - 1) };
    });

    res.json({
      success: true,
      data: {
        isLiked: result.isLiked,
        likesCount: result.likesCount
      },
      message: result.isLiked ? 'Story liked' : 'Story unliked'
    });

  } catch (error) {
    console.error('Error toggling like:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to toggle like',
      message: error.message
    });
  }
};

const toggleSave = async (req, res) => {
  try {
    const { id } = req.params;
    const userRef = db.collection('users').doc(req.user.uid);
    const storyRef = db.collection('stories').doc(id);

    const storyDoc = await storyRef.get();
    
    if (!storyDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Story not found',
        message: 'The requested story does not exist'
      });
    }

    const storyData = storyDoc.data();
    const isAuthor = req.user.uid === storyData.authorId;
    const isStaff = req.user.role === 'moderator' || req.user.role === 'admin';

    if (!isAuthor && !isStaff) {
      if (storyData.moderation?.status !== 'approved' || storyData.visibility !== 'public') {
        return res.status(404).json({
          success: false,
          error: 'Story not found',
          message: 'The requested story does not exist'
        });
      }
    }

    const result = await db.runTransaction(async (transaction) => {
      const storyDoc = await transaction.get(storyRef);
      const userDoc = await transaction.get(userRef);

      if (!storyDoc.exists) {
        throw new Error('Story not found');
      }

      const userData = userDoc.data() || {};
      const savedStories = userData.savedStories || [];
      const storyData = storyDoc.data();
      const savedBy = storyData.savedBy || [];

      let isSaved;

      if (savedStories.includes(id)) {
        if (userDoc.exists) {
          transaction.update(userRef, {
            savedStories: admin.firestore.FieldValue.arrayRemove(id)
          });
        }
        transaction.update(storyRef, {
          savedBy: admin.firestore.FieldValue.arrayRemove(req.user.uid)
        });
        isSaved = false;
      } else {
        transaction.set(userRef, {
          savedStories: admin.firestore.FieldValue.arrayUnion(id)
        }, { merge: true });
        transaction.update(storyRef, {
          savedBy: admin.firestore.FieldValue.arrayUnion(req.user.uid)
        });
        isSaved = true;
      }

      return { isSaved };
    });

    res.json({
      success: true,
      data: {
        isSaved: result.isSaved
      },
      message: result.isSaved ? 'Story saved' : 'Story unsaved'
    });

  } catch (error) {
    console.error('Error toggling save:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to toggle save',
      message: error.message
    });
  }
};

const toggleFollow = async (req, res) => {
  try {
    const { id } = req.params;
    const storyDoc = await db.collection('stories').doc(id).get();

    if (!storyDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Story not found',
        message: 'The requested story does not exist'
      });
    }

    const authorId = storyDoc.data().authorId;

    if (authorId === req.user.uid) {
      return res.status(400).json({
        success: false,
        error: 'Cannot follow yourself',
        message: 'You cannot follow your own account'
      });
    }

    const userRef = db.collection('users').doc(req.user.uid);
    const authorRef = db.collection('users').doc(authorId);

    const result = await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      const authorDoc = await transaction.get(authorRef);

      const userData = userDoc.data() || {};
      const authorData = authorDoc.data() || {};
      const following = userData.following || [];
      const followerCount = authorData.followerCount || 0;

      let isFollowing;

      if (following.includes(authorId)) {
        if (userDoc.exists) {
          transaction.update(userRef, {
            following: admin.firestore.FieldValue.arrayRemove(authorId)
          });
        }
        transaction.set(authorRef, {
          followerCount: Math.max(0, followerCount - 1)
        }, { merge: true });
        isFollowing = false;
      } else {
        transaction.set(userRef, {
          following: admin.firestore.FieldValue.arrayUnion(authorId)
        }, { merge: true });
        transaction.set(authorRef, {
          followerCount: followerCount + 1
        }, { merge: true });
        isFollowing = true;
      }

      return { isFollowing };
    });

    res.json({
      success: true,
      data: {
        isFollowing: result.isFollowing
      },
      message: result.isFollowing ? 'Following author' : 'Unfollowed author'
    });

  } catch (error) {
    console.error('Error toggling follow:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to toggle follow',
      message: error.message
    });
  }
};

const incrementView = async (req, res) => {
  try {
    const { id } = req.params;
    const storyRef = db.collection('stories').doc(id);
    
    const storyDoc = await storyRef.get();
    
    if (!storyDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Story not found',
        message: 'The requested story does not exist'
      });
    }

    const storyData = storyDoc.data();
    const isAuthor = req.user && req.user.uid === storyData.authorId;
    const isStaff = req.user && (req.user.role === 'moderator' || req.user.role === 'admin');

    if (!isAuthor && !isStaff) {
      if (storyData.moderation?.status !== 'approved' || storyData.visibility !== 'public') {
        return res.status(404).json({
          success: false,
          error: 'Story not found',
          message: 'The requested story does not exist'
        });
      }
    }

    await storyRef.update({
      views: admin.firestore.FieldValue.increment(1)
    });

    res.json({
      success: true,
      message: 'View counted'
    });

  } catch (error) {
    console.error('Error incrementing view:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to increment view',
      message: error.message
    });
  }
};

const getUserSavedStories = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = '1', limit = '20' } = req.query;

    const isOwner = req.user && req.user.uid === id;
    const isStaff = req.user && (req.user.role === 'moderator' || req.user.role === 'admin');

    if (!isOwner && !isStaff) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized',
        message: 'You can only view your own saved stories'
      });
    }

    const pageNum = parseInt(page, 10);
    const limitNum = Math.min(parseInt(limit, 10), 50);

    const userDoc = await db.collection('users').doc(id).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        message: 'The requested user does not exist'
      });
    }

    const userData = userDoc.data();
    const savedStoryIds = userData.savedStories || [];

    if (savedStoryIds.length === 0) {
      return res.json({
        success: true,
        data: {
          stories: [],
          pagination: {
            page: pageNum,
            limit: limitNum,
            hasMore: false,
            total: 0
          }
        }
      });
    }

    const startIdx = (pageNum - 1) * limitNum;
    const endIdx = startIdx + limitNum;
    const paginatedIds = savedStoryIds.slice(startIdx, endIdx + 1);
    const hasMore = paginatedIds.length > limitNum;
    const idsToFetch = hasMore ? paginatedIds.slice(0, limitNum) : paginatedIds;

    const storyPromises = idsToFetch.map(storyId => 
      db.collection('stories').doc(storyId).get()
    );
    const storyDocs = await Promise.all(storyPromises);

    const stories = storyDocs
      .filter(doc => doc.exists)
      .map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title,
          excerpt: data.excerpt,
          content: data.content,
          tags: data.tags,
          authorId: data.authorId,
          authorName: data.authorName,
          authorAvatar: data.authorAvatar,
          imageUrl: data.imageUrl,
          audioUrl: data.audioUrl,
          audioDuration: data.audioDuration,
          visibility: data.visibility,
          likesCount: data.likesCount,
          views: data.views,
          commentsCount: data.commentsCount,
          createdAt: data.createdAt?.toDate()?.toISOString(),
          updatedAt: data.updatedAt?.toDate()?.toISOString(),
          moderationStatus: data.moderation?.status
        };
      });

    res.json({
      success: true,
      data: {
        stories,
        pagination: {
          page: pageNum,
          limit: limitNum,
          hasMore,
          total: stories.length
        }
      }
    });

  } catch (error) {
    console.error('Error fetching saved stories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch saved stories',
      message: error.message
    });
  }
};

const getUserStories = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = '1', limit = '20' } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = Math.min(parseInt(limit, 10), 50);
    const offset = (pageNum - 1) * limitNum;

    const isOwner = req.user && req.user.uid === id;
    const isStaff = req.user && (req.user.role === 'moderator' || req.user.role === 'admin');

    let query = db.collection('stories')
      .where('authorId', '==', id);

    if (!isOwner && !isStaff) {
      query = query.where('moderation.status', '==', 'approved')
        .where('visibility', '==', 'public');
    }

    query = query.orderBy('createdAt', 'desc')
      .offset(offset)
      .limit(limitNum + 1);

    const snapshot = await query.get();
    const hasMore = snapshot.docs.length > limitNum;
    const docsToProcess = hasMore ? snapshot.docs.slice(0, limitNum) : snapshot.docs;

    const stories = docsToProcess.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title,
        excerpt: data.excerpt,
        content: data.content,
        tags: data.tags,
        authorId: data.authorId,
        authorName: data.authorName,
        authorAvatar: data.authorAvatar,
        imageUrl: data.imageUrl,
        audioUrl: data.audioUrl,
        audioDuration: data.audioDuration,
        visibility: data.visibility,
        likesCount: data.likesCount,
        views: data.views,
        commentsCount: data.commentsCount,
        createdAt: data.createdAt?.toDate()?.toISOString(),
        updatedAt: data.updatedAt?.toDate()?.toISOString(),
        moderationStatus: data.moderation?.status
      };
    });

    res.json({
      success: true,
      data: {
        stories,
        pagination: {
          page: pageNum,
          limit: limitNum,
          hasMore,
          total: stories.length
        }
      }
    });

  } catch (error) {
    console.error('Error fetching user stories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user stories',
      message: error.message
    });
  }
};

const reportStory = async (req, res) => {
  try {
    const { storyId, reason, details } = req.body;

    if (!storyId || !reason) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'Story ID and reason are required'
      });
    }

    const storyDoc = await db.collection('stories').doc(storyId).get();
    if (!storyDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Story not found',
        message: 'The reported story does not exist'
      });
    }

    const reportData = {
      storyId,
      reporterId: req.user.uid,
      reason,
      details: details || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const reportRef = await db.collection('reports').add(reportData);

    res.json({
      success: true,
      data: {
        reportId: reportRef.id
      },
      message: 'Story reported successfully'
    });

  } catch (error) {
    console.error('Error reporting story:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to report story',
      message: error.message
    });
  }
};

const moderateStory = async (req, res) => {
  try {
    const { storyId, action, notes } = req.body;

    if (!storyId || !action) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'Story ID and action are required'
      });
    }

    const validActions = ['approved', 'flagged', 'rejected'];
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid action',
        message: 'Action must be one of: approved, flagged, rejected'
      });
    }

    await db.collection('stories').doc(storyId).update({
      'moderation.status': action,
      'moderation.notes': notes || '',
      'moderation.moderatedBy': req.user.uid,
      'moderation.moderatedAt': admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      message: `Story ${action} successfully`
    });

  } catch (error) {
    console.error('Error moderating story:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to moderate story',
      message: error.message
    });
  }
};

module.exports = {
  createStory,
  getStories,
  getStoryById,
  updateStory,
  deleteStory,
  toggleLike,
  toggleSave,
  toggleFollow,
  incrementView,
  getUserSavedStories,
  getUserStories,
  reportStory,
  moderateStory
};
