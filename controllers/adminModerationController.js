const admin = require('firebase-admin');
const db = admin.firestore();

const listFlaggedComments = async (req, res) => {
  try {
    const { 
      status = 'flagged', 
      pageToken, 
      limit = 20, 
      q = '', 
      sort = 'createdAt' 
    } = req.query;

    const limitNum = Math.min(parseInt(limit) || 20, 100);
    
    let commentIds = new Set();
    let commentDocsMap = new Map();

    if (status === 'reported' || status === 'all') {
      const reportsSnapshot = await db.collection('reports')
        .where('type', '==', 'comment')
        .where('status', '==', 'pending')
        .get();
      
      reportsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.commentId) {
          commentIds.add(data.commentId);
        }
      });
    }

    let query = db.collection('comments');

    if (status === 'all') {
      query = query.where('moderation.status', 'in', ['flagged', 'pending', 'reported']);
    } else if (status === 'flagged') {
      query = query.where('moderation.status', '==', 'flagged');
    } else if (status === 'pending') {
      query = query.where('moderation.status', '==', 'pending');
    } else if (status === 'reported') {
      query = query.where('moderation.status', '==', 'reported');
    }

    if (sort === 'severity') {
      query = query.orderBy('moderation.highestScore', 'desc');
    } else {
      query = query.orderBy('createdAt', 'desc');
    }

    const snapshot = await query.get();
    
    snapshot.docs.forEach(doc => {
      commentIds.add(doc.id);
      commentDocsMap.set(doc.id, doc);
    });

    for (const commentId of commentIds) {
      if (!commentDocsMap.has(commentId)) {
        const commentDoc = await db.collection('comments').doc(commentId).get();
        if (commentDoc.exists) {
          commentDocsMap.set(commentId, commentDoc);
        }
      }
    }

    let allComments = Array.from(commentDocsMap.values())
      .map(doc => ({
        doc,
        data: doc.data()
      }));

    if (q) {
      allComments = allComments.filter(item => 
        item.data.content?.toLowerCase().includes(q.toLowerCase())
      );
    }

    if (sort === 'severity') {
      allComments.sort((a, b) => 
        (b.data.moderation?.highestScore || 0) - (a.data.moderation?.highestScore || 0)
      );
    } else {
      allComments.sort((a, b) => {
        const aTime = a.data.createdAt?.toMillis ? a.data.createdAt.toMillis() : 0;
        const bTime = b.data.createdAt?.toMillis ? b.data.createdAt.toMillis() : 0;
        return bTime - aTime;
      });
    }

    let startIndex = 0;
    if (pageToken) {
      startIndex = allComments.findIndex(item => item.doc.id === pageToken) + 1;
      if (startIndex === 0) startIndex = 0;
    }

    const paginatedComments = allComments.slice(startIndex, startIndex + limitNum);
    const hasMore = startIndex + limitNum < allComments.length;

    const items = [];
    for (const { doc, data } of paginatedComments) {
      const reportsSnapshot = await db.collection('reports')
        .where('commentId', '==', doc.id)
        .where('status', '==', 'pending')
        .count()
        .get();

      items.push({
        commentId: doc.id,
        storyId: data.storyId,
        authorId: data.authorId,
        content: data.content,
        createdAt: data.createdAt,
        moderation: data.moderation || {},
        reportsCount: reportsSnapshot.data().count
      });
    }

    const nextPageToken = hasMore && paginatedComments.length > 0 
      ? paginatedComments[paginatedComments.length - 1].doc.id 
      : null;

    res.json({
      success: true,
      items,
      meta: {
        nextPageToken,
        limit: limitNum,
        hasMore
      }
    });
  } catch (error) {
    console.error('List flagged comments error:', error);
    res.status(500).json({ 
      error: 'Failed to list flagged comments', 
      message: error.message 
    });
  }
};

const getCommentModerationDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const commentDoc = await db.collection('comments').doc(id).get();
    if (!commentDoc.exists) {
      return res.status(404).json({ 
        error: 'Comment not found', 
        message: 'The requested comment does not exist' 
      });
    }

    const commentData = commentDoc.data();

    const reportsSnapshot = await db.collection('reports')
      .where('commentId', '==', id)
      .get();
    const reports = reportsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    let storyMeta = null;
    if (commentData.storyId) {
      const storyDoc = await db.collection('stories').doc(commentData.storyId).get();
      if (storyDoc.exists) {
        const storyData = storyDoc.data();
        storyMeta = {
          storyId: commentData.storyId,
          title: storyData.title,
          category: storyData.category,
          authorId: storyData.authorId
        };
      }
    }

    let authorInfo = null;
    if (commentData.authorId) {
      const authorDoc = await db.collection('users').doc(commentData.authorId).get();
      if (authorDoc.exists) {
        const authorData = authorDoc.data();
        authorInfo = {
          userId: commentData.authorId,
          name: authorData.name,
          email: authorData.email,
          avatarUrl: authorData.avatarUrl
        };
      }
    }

    res.json({
      success: true,
      comment: {
        id: commentDoc.id,
        ...commentData
      },
      reports,
      storyMeta,
      authorInfo
    });
  } catch (error) {
    console.error('Get comment detail error:', error);
    res.status(500).json({ 
      error: 'Failed to get comment details', 
      message: error.message 
    });
  }
};

const moderatorDecision = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, notes = '' } = req.body;

    if (!['approve', 'reject', 'dismiss', 'resolve'].includes(action)) {
      return res.status(400).json({ 
        error: 'Invalid action', 
        message: 'Action must be one of: approve, reject, dismiss, resolve' 
      });
    }

    const commentRef = db.collection('comments').doc(id);
    const commentDoc = await commentRef.get();

    if (!commentDoc.exists) {
      return res.status(404).json({ 
        error: 'Comment not found', 
        message: 'The requested comment does not exist' 
      });
    }

    const commentData = commentDoc.data();
    const previousStatus = commentData.moderation?.status || 'unknown';
    let newStatus = previousStatus;
    let updateData = {};

    switch (action) {
      case 'approve':
        newStatus = 'approved';
        updateData = {
          approved: true,
          'moderation.status': 'approved',
          visibility: 'public'
        };
        
        if (!commentData.approved && commentData.storyId) {
          const storyRef = db.collection('stories').doc(commentData.storyId);
          await storyRef.update({
            commentsCount: admin.firestore.FieldValue.increment(1)
          }).catch(err => console.error('Failed to increment story comments:', err));
        }
        break;

      case 'reject':
        newStatus = 'rejected';
        updateData = {
          'moderation.status': 'rejected',
          visibility: 'hidden',
          approved: false
        };
        break;

      case 'dismiss':
        newStatus = 'dismissed';
        updateData = {
          'moderation.status': 'dismissed'
        };
        break;

      case 'resolve':
        newStatus = 'resolved';
        updateData = {
          'moderation.status': 'resolved'
        };
        
        const reportsSnapshot = await db.collection('reports')
          .where('commentId', '==', id)
          .where('status', '==', 'pending')
          .get();
        
        const batch = db.batch();
        reportsSnapshot.docs.forEach(doc => {
          batch.update(doc.ref, { 
            status: 'resolved',
            resolvedBy: req.user.uid,
            resolvedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
        break;
    }

    await commentRef.update(updateData);

    const auditId = db.collection('moderation').doc().id;
    await db.collection('moderation').doc('audit').collection('records').doc(auditId).set({
      commentId: id,
      moderatorId: req.user.uid,
      moderatorEmail: req.user.email,
      action,
      notes,
      previousStatus,
      newStatus,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    const updatedComment = await commentRef.get();

    res.json({
      success: true,
      message: `Comment ${action}d successfully`,
      comment: {
        id: updatedComment.id,
        ...updatedComment.data()
      },
      audit: {
        id: auditId,
        action,
        previousStatus,
        newStatus,
        moderatorId: req.user.uid
      }
    });
  } catch (error) {
    console.error('Moderator decision error:', error);
    res.status(500).json({ 
      error: 'Failed to process moderation decision', 
      message: error.message 
    });
  }
};

const bulkModeration = async (req, res) => {
  try {
    const { ids, action, notes = '' } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid input', 
        message: 'ids must be a non-empty array' 
      });
    }

    if (!['approve', 'reject', 'dismiss', 'resolve'].includes(action)) {
      return res.status(400).json({ 
        error: 'Invalid action', 
        message: 'Action must be one of: approve, reject, dismiss, resolve' 
      });
    }

    if (ids.length > 100) {
      return res.status(400).json({ 
        error: 'Too many items', 
        message: 'Maximum 100 items per bulk operation' 
      });
    }

    const results = {
      success: [],
      failed: []
    };

    for (const commentId of ids) {
      try {
        const commentRef = db.collection('comments').doc(commentId);
        const commentDoc = await commentRef.get();

        if (!commentDoc.exists) {
          results.failed.push({ commentId, reason: 'Comment not found' });
          continue;
        }

        const commentData = commentDoc.data();
        const previousStatus = commentData.moderation?.status || 'unknown';
        let newStatus = previousStatus;
        let updateData = {};

        switch (action) {
          case 'approve':
            newStatus = 'approved';
            updateData = {
              approved: true,
              'moderation.status': 'approved',
              visibility: 'public'
            };
            
            if (!commentData.approved && commentData.storyId) {
              const storyRef = db.collection('stories').doc(commentData.storyId);
              await storyRef.update({
                commentsCount: admin.firestore.FieldValue.increment(1)
              }).catch(err => console.error('Failed to increment story comments:', err));
            }
            break;

          case 'reject':
            newStatus = 'rejected';
            updateData = {
              'moderation.status': 'rejected',
              visibility: 'hidden',
              approved: false
            };
            break;

          case 'dismiss':
            newStatus = 'dismissed';
            updateData = {
              'moderation.status': 'dismissed'
            };
            break;

          case 'resolve':
            newStatus = 'resolved';
            updateData = {
              'moderation.status': 'resolved'
            };
            
            const reportsSnapshot = await db.collection('reports')
              .where('commentId', '==', commentId)
              .where('status', '==', 'pending')
              .get();
            
            const batch = db.batch();
            reportsSnapshot.docs.forEach(doc => {
              batch.update(doc.ref, { 
                status: 'resolved',
                resolvedBy: req.user.uid,
                resolvedAt: admin.firestore.FieldValue.serverTimestamp()
              });
            });
            await batch.commit();
            break;
        }

        await commentRef.update(updateData);

        const auditId = db.collection('moderation').doc().id;
        await db.collection('moderation').doc('audit').collection('records').doc(auditId).set({
          commentId,
          moderatorId: req.user.uid,
          moderatorEmail: req.user.email,
          action,
          notes,
          previousStatus,
          newStatus,
          bulkOperation: true,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        results.success.push({ 
          commentId, 
          action, 
          previousStatus, 
          newStatus 
        });
      } catch (error) {
        console.error(`Failed to process comment ${commentId}:`, error);
        results.failed.push({ commentId, reason: error.message });
      }
    }

    res.json({
      success: true,
      message: `Bulk ${action} completed`,
      results
    });
  } catch (error) {
    console.error('Bulk moderation error:', error);
    res.status(500).json({ 
      error: 'Failed to process bulk moderation', 
      message: error.message 
    });
  }
};

const listReports = async (req, res) => {
  try {
    const { 
      status = 'pending', 
      type = 'comment',
      pageToken, 
      limit = 20 
    } = req.query;

    const limitNum = Math.min(parseInt(limit) || 20, 100);
    let query = db.collection('reports')
      .where('type', '==', type);

    if (status !== 'all') {
      query = query.where('status', '==', status);
    }

    query = query.orderBy('createdAt', 'desc');

    if (pageToken) {
      const startAfterDoc = await db.collection('reports').doc(pageToken).get();
      if (startAfterDoc.exists) {
        query = query.startAfter(startAfterDoc);
      }
    }

    query = query.limit(limitNum + 1);
    const snapshot = await query.get();

    const hasMore = snapshot.docs.length > limitNum;
    const docsToProcess = hasMore ? snapshot.docs.slice(0, limitNum) : snapshot.docs;

    const reports = docsToProcess.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    const nextPageToken = hasMore ? docsToProcess[docsToProcess.length - 1].id : null;

    res.json({
      success: true,
      reports,
      meta: {
        nextPageToken,
        limit: limitNum,
        hasMore
      }
    });
  } catch (error) {
    console.error('List reports error:', error);
    res.status(500).json({ 
      error: 'Failed to list reports', 
      message: error.message 
    });
  }
};

const resolveReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { action = 'resolved', notes = '', triggerCommentAction = false } = req.body;

    if (!['resolved', 'dismissed'].includes(action)) {
      return res.status(400).json({ 
        error: 'Invalid action', 
        message: 'Action must be resolved or dismissed' 
      });
    }

    const reportRef = db.collection('reports').doc(reportId);
    const reportDoc = await reportRef.get();

    if (!reportDoc.exists) {
      return res.status(404).json({ 
        error: 'Report not found', 
        message: 'The requested report does not exist' 
      });
    }

    const reportData = reportDoc.data();
    
    await reportRef.update({
      status: action,
      resolvedBy: req.user.uid,
      resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      resolutionNotes: notes
    });

    const auditId = db.collection('moderation').doc().id;
    const auditRecord = {
      reportId,
      moderatorId: req.user.uid,
      moderatorEmail: req.user.email,
      action: `report_${action}`,
      notes,
      reportType: reportData.type,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    if (triggerCommentAction && reportData.commentId) {
      const commentRef = db.collection('comments').doc(reportData.commentId);
      const commentDoc = await commentRef.get();
      
      if (commentDoc.exists) {
        const commentData = commentDoc.data();
        const previousStatus = commentData.moderation?.status || 'unknown';
        
        await commentRef.update({
          'moderation.status': action === 'resolved' ? 'resolved' : 'dismissed'
        });

        auditRecord.commentId = reportData.commentId;
        auditRecord.previousStatus = previousStatus;
        auditRecord.newStatus = action === 'resolved' ? 'resolved' : 'dismissed';
        auditRecord.triggeredCommentAction = true;
      }
    } else if (reportData.commentId) {
      auditRecord.commentId = reportData.commentId;
      auditRecord.triggeredCommentAction = false;
    }

    await db.collection('moderation').doc('audit').collection('records').doc(auditId).set(auditRecord);

    const updatedReport = await reportRef.get();

    res.json({
      success: true,
      message: `Report ${action} successfully`,
      report: {
        id: updatedReport.id,
        ...updatedReport.data()
      }
    });
  } catch (error) {
    console.error('Resolve report error:', error);
    res.status(500).json({ 
      error: 'Failed to resolve report', 
      message: error.message 
    });
  }
};

module.exports = {
  listFlaggedComments,
  getCommentModerationDetail,
  moderatorDecision,
  bulkModeration,
  listReports,
  resolveReport
};
