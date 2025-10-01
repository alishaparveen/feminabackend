const request = require('supertest');
const admin = require('firebase-admin');
const express = require('express');

const app = express();
app.use(express.json());

const authenticateUser = (req, res, next) => {
  req.user = {
    uid: 'test-user-uid',
    email: 'user@test.com',
    role: 'user',
    customClaims: {}
  };
  next();
};

const adminAuthenticateUser = (req, res, next) => {
  req.user = {
    uid: 'admin-uid',
    email: 'admin@test.com',
    role: 'admin',
    customClaims: { role: 'admin' }
  };
  next();
};

const adminGuard = (req, res, next) => {
  if (req.user.customClaims.role === 'admin') {
    return next();
  }
  res.status(403).json({ error: 'Admin access required' });
};

const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    req.user = {
      uid: 'test-user-uid',
      email: 'user@test.com'
    };
  }
  next();
};

const preferencesRoutes = require('../routes/preferences');

app.use('/api/users', authenticateUser, preferencesRoutes);
app.get('/api/recommendations/categories', optionalAuth, preferencesRoutes);

const adminApp = express();
adminApp.use(express.json());
const adminRouter = express.Router();
adminRouter.use(adminAuthenticateUser);
adminRouter.use(adminGuard);
adminRouter.use(preferencesRoutes);
adminApp.use('/api/admin', adminRouter);

jest.mock('firebase-admin', () => {
  const mockFirestore = {
    collection: jest.fn()
  };
  
  return {
    firestore: jest.fn(() => mockFirestore),
    FieldValue: {
      serverTimestamp: jest.fn(() => new Date()),
      arrayUnion: jest.fn(val => ({ _arrayUnion: val })),
      arrayRemove: jest.fn(val => ({ _arrayRemove: val })),
      delete: jest.fn(() => ({ _delete: true }))
    }
  };
});

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-1234')
}));

describe('User Preferences API', () => {
  let db;
  
  beforeEach(() => {
    jest.clearAllMocks();
    db = admin.firestore();
  });

  describe('GET /api/users/me/preferences', () => {
    it('should return user preferences', async () => {
      const mockPreferences = {
        followedCategories: ['Health/Mental Health', 'Career'],
        savedFilters: {},
        discoverySettings: {}
      };

      const mockUserDoc = {
        exists: true,
        data: () => ({ preferences: mockPreferences })
      };

      db.collection.mockReturnValue({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue(mockUserDoc)
        })
      });

      const response = await request(app)
        .get('/api/users/me/preferences')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.followedCategories).toHaveLength(2);
    });

    it('should return default preferences if none exist', async () => {
      const mockUserDoc = {
        exists: false
      };

      db.collection.mockReturnValue({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue(mockUserDoc)
        })
      });

      const response = await request(app)
        .get('/api/users/me/preferences')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.followedCategories).toEqual([]);
    });
  });

  describe('POST /api/users/me/preferences/follow', () => {
    it('should follow a category', async () => {
      const mockUserDoc = {
        exists: true,
        data: () => ({
          preferences: { followedCategories: ['Health'] }
        })
      };

      const mockUserRef = {
        get: jest.fn().mockResolvedValue(mockUserDoc),
        set: jest.fn().mockResolvedValue({})
      };

      db.collection.mockReturnValue({
        doc: jest.fn().mockReturnValue(mockUserRef)
      });

      const response = await request(app)
        .post('/api/users/me/preferences/follow')
        .send({ category: 'Career' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockUserRef.set).toHaveBeenCalled();
    });

    it('should reject invalid category', async () => {
      const response = await request(app)
        .post('/api/users/me/preferences/follow')
        .send({ category: 'InvalidCategory' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid category');
    });

    it('should reject missing category', async () => {
      const response = await request(app)
        .post('/api/users/me/preferences/follow')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Category is required');
    });
  });

  describe('POST /api/users/me/preferences/unfollow', () => {
    it('should unfollow a category', async () => {
      const mockUserDoc = {
        exists: true,
        data: () => ({
          preferences: { followedCategories: ['Health', 'Career'] }
        })
      };

      const mockUserRef = {
        get: jest.fn().mockResolvedValue(mockUserDoc),
        set: jest.fn().mockResolvedValue({})
      };

      db.collection.mockReturnValue({
        doc: jest.fn().mockReturnValue(mockUserRef)
      });

      const response = await request(app)
        .post('/api/users/me/preferences/unfollow')
        .send({ category: 'Career' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockUserRef.set).toHaveBeenCalled();
    });
  });

  describe('POST /api/users/me/preferences/filters', () => {
    it('should create a saved filter', async () => {
      const mockUserRef = {
        set: jest.fn().mockResolvedValue({})
      };

      db.collection.mockReturnValue({
        doc: jest.fn().mockReturnValue(mockUserRef)
      });

      const filterData = {
        name: 'My Health Filter',
        type: 'stories',
        query: {
          category: 'Health',
          sort: 'newest',
          pageSize: 10
        }
      };

      const response = await request(app)
        .post('/api/users/me/preferences/filters')
        .send(filterData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.filter.name).toBe('My Health Filter');
      expect(response.body.data.filter.id).toBe('mock-uuid-1234');
    });

    it('should reject invalid filter type', async () => {
      const filterData = {
        name: 'Invalid Filter',
        type: 'invalid_type',
        query: { category: 'Health' }
      };

      const response = await request(app)
        .post('/api/users/me/preferences/filters')
        .send(filterData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid filter type');
    });

    it('should reject invalid query fields', async () => {
      const filterData = {
        name: 'Bad Filter',
        type: 'stories',
        query: {
          category: 'Health',
          invalidField: 'value'
        }
      };

      const response = await request(app)
        .post('/api/users/me/preferences/filters')
        .send(filterData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid filter fields');
    });
  });

  describe('PUT /api/users/me/preferences/filters/:filterId', () => {
    it('should update a saved filter', async () => {
      const mockUserDoc = {
        exists: true,
        data: () => ({
          preferences: {
            savedFilters: {
              'filter-123': {
                id: 'filter-123',
                name: 'Old Name',
                type: 'stories',
                query: { category: 'Health' }
              }
            }
          }
        })
      };

      const mockUserRef = {
        get: jest.fn().mockResolvedValue(mockUserDoc),
        set: jest.fn().mockResolvedValue({})
      };

      db.collection.mockReturnValue({
        doc: jest.fn().mockReturnValue(mockUserRef)
      });

      const response = await request(app)
        .put('/api/users/me/preferences/filters/filter-123')
        .send({ name: 'New Name' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockUserRef.set).toHaveBeenCalled();
    });

    it('should return 404 if filter not found', async () => {
      const mockUserDoc = {
        exists: true,
        data: () => ({
          preferences: { savedFilters: {} }
        })
      };

      const mockUserRef = {
        get: jest.fn().mockResolvedValue(mockUserDoc)
      };

      db.collection.mockReturnValue({
        doc: jest.fn().mockReturnValue(mockUserRef)
      });

      const response = await request(app)
        .put('/api/users/me/preferences/filters/nonexistent')
        .send({ name: 'New Name' })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /api/users/me/preferences/filters/:filterId', () => {
    it('should delete a saved filter', async () => {
      const mockUserDoc = {
        exists: true,
        data: () => ({
          preferences: {
            savedFilters: {
              'filter-123': {
                id: 'filter-123',
                name: 'Test Filter'
              }
            }
          }
        })
      };

      const mockUserRef = {
        get: jest.fn().mockResolvedValue(mockUserDoc),
        set: jest.fn().mockResolvedValue({})
      };

      db.collection.mockReturnValue({
        doc: jest.fn().mockReturnValue(mockUserRef)
      });

      const response = await request(app)
        .delete('/api/users/me/preferences/filters/filter-123')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockUserRef.set).toHaveBeenCalled();
    });
  });

  describe('GET /api/recommendations/categories', () => {
    it('should return recommended categories', async () => {
      const response = await request(app)
        .get('/api/recommendations/categories')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.recommendations).toBeDefined();
      expect(Array.isArray(response.body.data.recommendations)).toBe(true);
    });

    it('should return age-based recommendations', async () => {
      const response = await request(app)
        .get('/api/recommendations/categories?age=28')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/admin/seed-preferences (Admin only)', () => {
    it('should seed demo preferences for a user', async () => {
      const mockUserRef = {
        set: jest.fn().mockResolvedValue({})
      };

      db.collection.mockReturnValue({
        doc: jest.fn().mockReturnValue(mockUserRef)
      });

      const response = await request(adminApp)
        .post('/api/admin/seed-preferences')
        .send({ uid: 'test-user-123' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.preferences.followedCategories).toBeDefined();
      expect(mockUserRef.set).toHaveBeenCalled();
    });

    it('should reject without uid', async () => {
      const response = await request(adminApp)
        .post('/api/admin/seed-preferences')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('User ID is required');
    });
  });
});
