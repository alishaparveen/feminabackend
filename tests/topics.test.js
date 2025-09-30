const admin = require('firebase-admin');

const mockFirestore = {
  collection: jest.fn(() => ({
    doc: jest.fn(() => ({
      get: jest.fn(),
      set: jest.fn(),
      update: jest.fn()
    })),
    add: jest.fn(),
    where: jest.fn(() => mockFirestore.collection()),
    orderBy: jest.fn(() => mockFirestore.collection()),
    limit: jest.fn(() => mockFirestore.collection()),
    get: jest.fn()
  })),
  runTransaction: jest.fn()
};

jest.mock('firebase-admin', () => ({
  firestore: jest.fn(() => mockFirestore),
  apps: [],
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn()
  }
}));

const topicsController = require('../controllers/topicsController');
const storiesController = require('../controllers/storiesController');

describe('Topics API', () => {
  let req, res;

  beforeEach(() => {
    req = {
      query: {},
      body: {},
      params: {},
      user: {
        uid: 'test-user-123',
        email: 'test@example.com',
        name: 'Test User',
        avatarUrl: null,
        role: 'user'
      }
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    jest.clearAllMocks();
  });

  describe('GET /v1/topics', () => {
    it('should return topics without counts by default', async () => {
      await topicsController.getTopics(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          topics: expect.arrayContaining([
            expect.objectContaining({
              category: 'Health',
              subCategories: expect.any(Array)
            })
          ])
        }
      });
    });

    it('should return topics with counts when includeCounts=true', async () => {
      req.query.includeCounts = 'true';

      const mockMetaDoc = {
        exists: true,
        data: () => ({
          Health: 10,
          Career: 5,
          Finance: 3
        })
      };

      mockFirestore.collection().doc().get.mockResolvedValue(mockMetaDoc);

      await topicsController.getTopics(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          topics: expect.arrayContaining([
            expect.objectContaining({
              category: 'Health',
              subCategories: expect.any(Array),
              count: expect.any(Number)
            })
          ])
        }
      });
    });
  });

  describe('GET /v1/topics/counts', () => {
    it('should return category counts from meta document', async () => {
      const mockCounts = {
        Health: 12,
        Career: 8,
        Finance: 5
      };

      const mockMetaDoc = {
        exists: true,
        data: () => mockCounts
      };

      mockFirestore.collection().doc().get.mockResolvedValue(mockMetaDoc);

      await topicsController.getCategoryCounts(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          counts: mockCounts
        }
      });
    });

    it('should compute counts if meta document does not exist', async () => {
      const mockMetaDoc = {
        exists: false
      };

      const mockSnapshot = {
        forEach: jest.fn((callback) => {
          callback({ data: () => ({ category: 'Health' }) });
          callback({ data: () => ({ category: 'Health' }) });
          callback({ data: () => ({ category: 'Career' }) });
        })
      };

      mockFirestore.collection().doc().get.mockResolvedValue(mockMetaDoc);
      mockFirestore.collection().get.mockResolvedValue(mockSnapshot);

      await topicsController.getCategoryCounts(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          counts: expect.any(Object)
        }
      });
    });
  });

  describe('Story creation with category', () => {
    it('should create story with category and update counts', async () => {
      req.body = {
        title: 'Test Story',
        content: 'Test content',
        category: 'Health',
        subCategory: 'Mental Health',
        tags: ['wellness', 'mindfulness']
      };

      const mockStoryRef = {
        id: 'story-123',
        get: jest.fn().mockResolvedValue({
          data: () => ({
            ...req.body,
            authorId: req.user.uid,
            authorName: req.user.name,
            createdAt: { toDate: () => new Date() },
            updatedAt: { toDate: () => new Date() }
          })
        })
      };

      mockFirestore.collection().add.mockResolvedValue(mockStoryRef);
      mockFirestore.runTransaction.mockImplementation(async (callback) => {
        const transaction = {
          get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ Health: 5 }) }),
          update: jest.fn(),
          set: jest.fn()
        };
        await callback(transaction);
      });

      await storiesController.createStory(req, res);

      expect(mockFirestore.collection).toHaveBeenCalledWith('stories');
      expect(mockFirestore.runTransaction).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            story: expect.objectContaining({
              category: 'Health',
              subCategory: 'Mental Health'
            })
          })
        })
      );
    });
  });

  describe('GET /v1/stories with category filter', () => {
    it('should filter stories by category', async () => {
      req.query = {
        category: 'Health',
        page: '1',
        limit: '20'
      };

      const mockSnapshot = {
        docs: [{
          id: 'story-1',
          data: () => ({
            title: 'Health Story',
            category: 'Health',
            tags: ['wellness'],
            createdAt: { toDate: () => new Date() },
            updatedAt: { toDate: () => new Date() },
            moderation: { status: 'approved' }
          })
        }]
      };

      mockFirestore.collection().where().where().where().orderBy().offset().limit().get
        .mockResolvedValue(mockSnapshot);

      await storiesController.getStories(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            stories: expect.arrayContaining([
              expect.objectContaining({
                category: 'Health'
              })
            ])
          })
        })
      );
    });
  });
});
