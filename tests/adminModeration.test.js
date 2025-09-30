const request = require('supertest');
const admin = require('firebase-admin');
const express = require('express');

const app = express();
app.use(express.json());

const authenticateUser = (req, res, next) => {
  req.user = {
    uid: 'test-moderator-uid',
    email: 'moderator@test.com',
    customClaims: { moderator: true }
  };
  next();
};

const requireModerator = require('../middleware/requireModerator');
const adminModerationRoutes = require('../routes/adminModeration');

app.use(authenticateUser);
app.use(requireModerator);
app.use('/api/admin/moderation', adminModerationRoutes);

jest.mock('firebase-admin', () => {
  const mockFirestore = {
    collection: jest.fn()
  };
  
  return {
    firestore: jest.fn(() => mockFirestore),
    auth: jest.fn(() => ({
      verifyIdToken: jest.fn()
    })),
    FieldValue: {
      serverTimestamp: jest.fn(() => new Date()),
      increment: jest.fn(val => ({ _increment: val }))
    }
  };
});

describe('Admin Moderation API', () => {
  let db;
  
  beforeEach(() => {
    jest.clearAllMocks();
    db = admin.firestore();
  });

  describe('GET /api/admin/moderation/comments', () => {
    it('should list flagged comments only', async () => {
      const mockComments = [
        {
          id: 'comment1',
          data: () => ({
            content: 'Flagged content',
            authorId: 'user1',
            storyId: 'story1',
            createdAt: new Date(),
            moderation: { status: 'flagged', highestScore: 0.95 }
          })
        }
      ];

      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: mockComments })
      };

      const mockReportsCount = {
        get: jest.fn().mockResolvedValue({ data: () => ({ count: 2 }) })
      };

      db.collection.mockImplementation((collectionName) => {
        if (collectionName === 'comments') {
          return mockQuery;
        }
        if (collectionName === 'reports') {
          return {
            where: jest.fn().mockReturnThis(),
            count: jest.fn().mockReturnValue(mockReportsCount)
          };
        }
      });

      const response = await request(app)
        .get('/api/admin/moderation/comments?status=flagged')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].commentId).toBe('comment1');
    });

    it('should support severity sorting', async () => {
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: [] })
      };

      db.collection.mockReturnValue(mockQuery);

      await request(app)
        .get('/api/admin/moderation/comments?sort=severity')
        .expect(200);

      expect(mockQuery.orderBy).toHaveBeenCalledWith('moderation.highestScore', 'desc');
    });

    it('should support text search', async () => {
      const mockComments = [
        {
          id: 'comment1',
          data: () => ({
            content: 'This contains search term',
            authorId: 'user1',
            storyId: 'story1',
            createdAt: new Date(),
            moderation: { status: 'flagged' }
          })
        },
        {
          id: 'comment2',
          data: () => ({
            content: 'This does not match',
            authorId: 'user2',
            storyId: 'story2',
            createdAt: new Date(),
            moderation: { status: 'flagged' }
          })
        }
      ];

      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: mockComments })
      };

      const mockReportsCount = {
        get: jest.fn().mockResolvedValue({ data: () => ({ count: 0 }) })
      };

      db.collection.mockImplementation((collectionName) => {
        if (collectionName === 'comments') {
          return mockQuery;
        }
        if (collectionName === 'reports') {
          return {
            where: jest.fn().mockReturnThis(),
            count: jest.fn().mockReturnValue(mockReportsCount)
          };
        }
      });

      const response = await request(app)
        .get('/api/admin/moderation/comments?q=search')
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].content).toContain('search');
    });
  });

  describe('GET /api/admin/moderation/comments/:id', () => {
    it('should return comment with full moderation details', async () => {
      const mockComment = {
        exists: true,
        data: () => ({
          content: 'Test comment',
          authorId: 'user1',
          storyId: 'story1',
          createdAt: new Date(),
          moderation: { 
            status: 'flagged',
            analysis: { TOXICITY: 0.92 }
          }
        })
      };

      const mockReports = {
        docs: [
          {
            id: 'report1',
            data: () => ({ reason: 'harassment', reportedBy: 'user2' })
          }
        ]
      };

      const mockStory = {
        exists: true,
        data: () => ({
          title: 'Test Story',
          category: 'Health',
          authorId: 'user1'
        })
      };

      const mockAuthor = {
        exists: true,
        data: () => ({
          name: 'Test User',
          email: 'test@example.com',
          avatarUrl: 'https://example.com/avatar.jpg'
        })
      };

      db.collection.mockImplementation((collectionName) => {
        if (collectionName === 'comments') {
          return { doc: () => ({ get: jest.fn().mockResolvedValue(mockComment) }) };
        }
        if (collectionName === 'reports') {
          return {
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(mockReports)
          };
        }
        if (collectionName === 'stories') {
          return { doc: () => ({ get: jest.fn().mockResolvedValue(mockStory) }) };
        }
        if (collectionName === 'users') {
          return { doc: () => ({ get: jest.fn().mockResolvedValue(mockAuthor) }) };
        }
      });

      const response = await request(app)
        .get('/api/admin/moderation/comments/comment1')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.comment).toBeDefined();
      expect(response.body.reports).toHaveLength(1);
      expect(response.body.storyMeta).toBeDefined();
      expect(response.body.authorInfo).toBeDefined();
    });

    it('should return 404 for non-existent comment', async () => {
      db.collection.mockReturnValue({
        doc: () => ({ get: jest.fn().mockResolvedValue({ exists: false }) })
      });

      const response = await request(app)
        .get('/api/admin/moderation/comments/nonexistent')
        .expect(404);

      expect(response.body.error).toBe('Comment not found');
    });
  });

  describe('PUT /api/admin/moderation/comments/:id', () => {
    it('should approve a comment and increment story comment count', async () => {
      const mockComment = {
        exists: true,
        data: () => ({
          content: 'Test comment',
          authorId: 'user1',
          storyId: 'story1',
          approved: false,
          moderation: { status: 'pending' }
        })
      };

      const mockCommentRef = {
        get: jest.fn().mockResolvedValue(mockComment),
        update: jest.fn().mockResolvedValue({})
      };

      const mockStoryRef = {
        update: jest.fn().mockResolvedValue({})
      };

      const mockAuditRef = {
        set: jest.fn().mockResolvedValue({})
      };

      db.collection.mockImplementation((collectionName) => {
        if (collectionName === 'comments') {
          return { doc: () => mockCommentRef };
        }
        if (collectionName === 'stories') {
          return { doc: () => mockStoryRef };
        }
        if (collectionName === 'moderation') {
          return {
            doc: (docId) => {
              if (docId === 'audit') {
                return {
                  collection: () => ({
                    doc: () => mockAuditRef
                  })
                };
              }
              return { id: 'generated-id' };
            }
          };
        }
      });

      const response = await request(app)
        .put('/api/admin/moderation/comments/comment1')
        .send({ action: 'approve', notes: 'Looks fine' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockCommentRef.update).toHaveBeenCalled();
      expect(mockAuditRef.set).toHaveBeenCalled();
    });

    it('should reject a comment and hide it', async () => {
      const mockComment = {
        exists: true,
        data: () => ({
          content: 'Bad comment',
          moderation: { status: 'flagged' }
        })
      };

      const mockCommentRef = {
        get: jest.fn().mockResolvedValue(mockComment),
        update: jest.fn().mockResolvedValue({})
      };

      const mockAuditRef = {
        set: jest.fn().mockResolvedValue({})
      };

      db.collection.mockImplementation((collectionName) => {
        if (collectionName === 'comments') {
          return { doc: () => mockCommentRef };
        }
        if (collectionName === 'moderation') {
          return {
            doc: (docId) => {
              if (docId === 'audit') {
                return {
                  collection: () => ({
                    doc: () => mockAuditRef
                  })
                };
              }
              return { id: 'generated-id' };
            }
          };
        }
      });

      const response = await request(app)
        .put('/api/admin/moderation/comments/comment1')
        .send({ action: 'reject', notes: 'Violates guidelines' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockCommentRef.update).toHaveBeenCalledWith(
        expect.objectContaining({
          'moderation.status': 'rejected',
          visibility: 'hidden',
          approved: false
        })
      );
    });

    it('should resolve comment and mark reports as resolved', async () => {
      const mockComment = {
        exists: true,
        data: () => ({
          content: 'Test comment',
          moderation: { status: 'reported' }
        })
      };

      const mockCommentRef = {
        get: jest.fn().mockResolvedValue(mockComment),
        update: jest.fn().mockResolvedValue({})
      };

      const mockReports = {
        docs: [
          { ref: { update: jest.fn() } },
          { ref: { update: jest.fn() } }
        ]
      };

      const mockBatch = {
        update: jest.fn(),
        commit: jest.fn().mockResolvedValue({})
      };

      db.batch = jest.fn(() => mockBatch);

      db.collection.mockImplementation((collectionName) => {
        if (collectionName === 'comments') {
          return { doc: () => mockCommentRef };
        }
        if (collectionName === 'reports') {
          return {
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(mockReports)
          };
        }
        if (collectionName === 'moderation') {
          return {
            doc: (docId) => {
              if (docId === 'audit') {
                return {
                  collection: () => ({
                    doc: () => ({ set: jest.fn() })
                  })
                };
              }
              return { id: 'generated-id' };
            }
          };
        }
      });

      const response = await request(app)
        .put('/api/admin/moderation/comments/comment1')
        .send({ action: 'resolve' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockBatch.commit).toHaveBeenCalled();
    });

    it('should reject invalid actions', async () => {
      const response = await request(app)
        .put('/api/admin/moderation/comments/comment1')
        .send({ action: 'invalid_action' })
        .expect(400);

      expect(response.body.error).toBe('Invalid action');
    });
  });

  describe('POST /api/admin/moderation/comments/bulk', () => {
    it('should process bulk moderation actions', async () => {
      const mockComments = {
        comment1: {
          exists: true,
          data: () => ({
            content: 'Comment 1',
            storyId: 'story1',
            approved: false,
            moderation: { status: 'pending' }
          })
        },
        comment2: {
          exists: true,
          data: () => ({
            content: 'Comment 2',
            storyId: 'story2',
            approved: false,
            moderation: { status: 'pending' }
          })
        }
      };

      db.collection.mockImplementation((collectionName) => {
        if (collectionName === 'comments') {
          return {
            doc: (id) => ({
              get: jest.fn().mockResolvedValue(mockComments[id]),
              update: jest.fn().mockResolvedValue({})
            })
          };
        }
        if (collectionName === 'stories') {
          return {
            doc: () => ({
              update: jest.fn().mockResolvedValue({})
            })
          };
        }
        if (collectionName === 'moderation') {
          return {
            doc: (docId) => {
              if (docId === 'audit') {
                return {
                  collection: () => ({
                    doc: () => ({ set: jest.fn() })
                  })
                };
              }
              return { id: 'generated-id' };
            }
          };
        }
      });

      const response = await request(app)
        .post('/api/admin/moderation/comments/bulk')
        .send({ 
          ids: ['comment1', 'comment2'], 
          action: 'approve',
          notes: 'Bulk approval'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.results.success).toHaveLength(2);
      expect(response.body.results.failed).toHaveLength(0);
    });

    it('should handle partial failures in bulk operations', async () => {
      db.collection.mockImplementation((collectionName) => {
        if (collectionName === 'comments') {
          return {
            doc: (id) => ({
              get: jest.fn().mockResolvedValue(
                id === 'comment1' 
                  ? { exists: true, data: () => ({ moderation: {} }) }
                  : { exists: false }
              ),
              update: jest.fn().mockResolvedValue({})
            })
          };
        }
        if (collectionName === 'moderation') {
          return {
            doc: (docId) => {
              if (docId === 'audit') {
                return {
                  collection: () => ({
                    doc: () => ({ set: jest.fn() })
                  })
                };
              }
              return { id: 'generated-id' };
            }
          };
        }
      });

      const response = await request(app)
        .post('/api/admin/moderation/comments/bulk')
        .send({ 
          ids: ['comment1', 'nonexistent'], 
          action: 'approve'
        })
        .expect(200);

      expect(response.body.results.success).toHaveLength(1);
      expect(response.body.results.failed).toHaveLength(1);
    });

    it('should reject bulk operations with too many items', async () => {
      const ids = Array(101).fill(0).map((_, i) => `comment${i}`);

      const response = await request(app)
        .post('/api/admin/moderation/comments/bulk')
        .send({ ids, action: 'approve' })
        .expect(400);

      expect(response.body.error).toBe('Too many items');
    });
  });

  describe('GET /api/admin/reports/comments', () => {
    it('should list only comment reports', async () => {
      const mockReports = [
        {
          id: 'report1',
          data: () => ({
            type: 'comment',
            commentId: 'comment1',
            reason: 'harassment',
            status: 'pending'
          })
        }
      ];

      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: mockReports })
      };

      db.collection.mockReturnValue(mockQuery);

      const response = await request(app)
        .get('/api/admin/reports/comments?status=pending')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.reports).toHaveLength(1);
      expect(mockQuery.where).toHaveBeenCalledWith('type', '==', 'comment');
    });
  });

  describe('PUT /api/admin/reports/:reportId', () => {
    it('should resolve a report', async () => {
      const mockReport = {
        exists: true,
        data: () => ({
          commentId: 'comment1',
          status: 'pending',
          type: 'comment'
        })
      };

      const mockReportRef = {
        get: jest.fn().mockResolvedValue(mockReport),
        update: jest.fn().mockResolvedValue({})
      };

      db.collection.mockReturnValue({
        doc: () => mockReportRef
      });

      const response = await request(app)
        .put('/api/admin/reports/report1')
        .send({ action: 'resolved', notes: 'Issue resolved' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockReportRef.update).toHaveBeenCalled();
    });

    it('should resolve report and trigger comment action', async () => {
      const mockReport = {
        exists: true,
        data: () => ({
          commentId: 'comment1',
          status: 'pending',
          type: 'comment'
        })
      };

      const mockComment = {
        exists: true,
        data: () => ({
          content: 'Test',
          moderation: { status: 'reported' }
        })
      };

      db.collection.mockImplementation((collectionName) => {
        if (collectionName === 'reports') {
          return {
            doc: () => ({
              get: jest.fn().mockResolvedValue(mockReport),
              update: jest.fn().mockResolvedValue({})
            })
          };
        }
        if (collectionName === 'comments') {
          return {
            doc: () => ({
              get: jest.fn().mockResolvedValue(mockComment),
              update: jest.fn().mockResolvedValue({})
            })
          };
        }
        if (collectionName === 'moderation') {
          return {
            doc: (docId) => {
              if (docId === 'audit') {
                return {
                  collection: () => ({
                    doc: () => ({ set: jest.fn() })
                  })
                };
              }
              return { id: 'generated-id' };
            }
          };
        }
      });

      const response = await request(app)
        .put('/api/admin/reports/report1')
        .send({ 
          action: 'resolved', 
          notes: 'Resolved',
          triggerCommentAction: true 
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });
});
