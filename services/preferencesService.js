const admin = require('firebase-admin');
const db = admin.firestore();
const { v4: uuidv4 } = require('uuid');

const VALID_CATEGORIES = [
  'Health',
  'Health/Mental Health',
  'Health/PCOS',
  'Health/Pregnancy',
  'Health/Menopause',
  'Career',
  'Career/Career Growth',
  'Career/Work-Life Balance',
  'Career/Leadership',
  'Relationships',
  'Relationships/Marriage',
  'Relationships/Dating',
  'Relationships/Friendship',
  'Parenting',
  'Parenting/Newborn',
  'Parenting/Toddler',
  'Parenting/Teen',
  'Finance',
  'Finance/Investing',
  'Finance/Budgeting',
  'Finance/Entrepreneurship',
  'Lifestyle',
  'Lifestyle/Travel',
  'Lifestyle/Hobbies',
  'Lifestyle/Home',
  'Education',
  'Education/Skills',
  'Education/Degrees',
  'Support',
  'Support/Abuse',
  'Support/Loss',
  'Support/Trauma',
  'Wellness',
  'Wellness/Yoga',
  'Wellness/Meditation',
  'Wellness/Fitness',
  'Legal',
  'Legal/Family Law',
  'Legal/Workplace Law',
  'Legal/Property Rights'
];

const VALID_FILTER_FIELDS = ['category', 'subCategory', 'tags', 'sort', 'pageSize', 'dateRange'];
const VALID_FILTER_TYPES = ['stories', 'community'];

function validateCategory(category) {
  if (!category || typeof category !== 'string') {
    throw new Error('Category must be a non-empty string');
  }
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error(`Invalid category: ${category}`);
  }
  return true;
}

function validateFilterQuery(query) {
  if (!query || typeof query !== 'object') {
    throw new Error('Filter query must be an object');
  }

  const invalidFields = Object.keys(query).filter(key => !VALID_FILTER_FIELDS.includes(key));
  if (invalidFields.length > 0) {
    throw new Error(`Invalid filter fields: ${invalidFields.join(', ')}`);
  }

  if (query.category && !VALID_CATEGORIES.includes(query.category)) {
    throw new Error(`Invalid category in filter: ${query.category}`);
  }

  if (query.subCategory) {
    if (!VALID_CATEGORIES.includes(query.subCategory)) {
      throw new Error(`Invalid subCategory in filter: ${query.subCategory}`);
    }
    if (query.category && !query.subCategory.startsWith(query.category + '/')) {
      throw new Error(`SubCategory "${query.subCategory}" is not compatible with category "${query.category}"`);
    }
  }

  if (query.sort && !['newest', 'top', 'most_commented'].includes(query.sort)) {
    throw new Error(`Invalid sort value: ${query.sort}`);
  }

  if (query.pageSize && (typeof query.pageSize !== 'number' || query.pageSize < 1 || query.pageSize > 50)) {
    throw new Error('PageSize must be a number between 1 and 50');
  }

  return true;
}

async function getUserPreferences(uid) {
  const userDoc = await db.collection('users').doc(uid).get();
  
  if (!userDoc.exists) {
    return {
      followedCategories: [],
      savedFilters: {},
      discoverySettings: {}
    };
  }

  const preferences = userDoc.data().preferences || {
    followedCategories: [],
    savedFilters: {},
    discoverySettings: {}
  };

  return preferences;
}

async function updateUserPreferences(uid, updates) {
  const userRef = db.collection('users').doc(uid);
  
  await userRef.set({
    preferences: updates
  }, { merge: true });

  return updates;
}

async function followCategory(uid, category) {
  validateCategory(category);
  
  const userRef = db.collection('users').doc(uid);
  
  await userRef.set({
    preferences: {
      followedCategories: admin.firestore.FieldValue.arrayUnion(category)
    }
  }, { merge: true });

  const prefs = await getUserPreferences(uid);
  return prefs.followedCategories;
}

async function unfollowCategory(uid, category) {
  validateCategory(category);
  
  const userRef = db.collection('users').doc(uid);
  
  await userRef.set({
    preferences: {
      followedCategories: admin.firestore.FieldValue.arrayRemove(category)
    }
  }, { merge: true });

  const prefs = await getUserPreferences(uid);
  return prefs.followedCategories;
}

async function createSavedFilter(uid, { name, type, query }) {
  if (!name || typeof name !== 'string') {
    throw new Error('Filter name is required');
  }

  if (!VALID_FILTER_TYPES.includes(type)) {
    throw new Error(`Invalid filter type: ${type}. Must be 'stories' or 'community'`);
  }

  validateFilterQuery(query);

  const filterId = uuidv4();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const filter = {
    id: filterId,
    name,
    type,
    query,
    createdAt: now,
    updatedAt: now
  };

  const userRef = db.collection('users').doc(uid);
  
  await userRef.set({
    preferences: {
      savedFilters: {
        [filterId]: filter
      }
    }
  }, { merge: true });

  return filter;
}

async function updateSavedFilter(uid, filterId, updates) {
  const prefs = await getUserPreferences(uid);
  
  if (!prefs.savedFilters || !prefs.savedFilters[filterId]) {
    throw new Error('Filter not found');
  }

  if (updates.name && typeof updates.name !== 'string') {
    throw new Error('Filter name must be a string');
  }

  if (updates.query) {
    validateFilterQuery(updates.query);
  }

  const updatedFilter = {
    ...prefs.savedFilters[filterId],
    ...(updates.name && { name: updates.name }),
    ...(updates.query && { query: updates.query }),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const userRef = db.collection('users').doc(uid);
  
  await userRef.set({
    preferences: {
      savedFilters: {
        [filterId]: updatedFilter
      }
    }
  }, { merge: true });

  return updatedFilter;
}

async function deleteSavedFilter(uid, filterId) {
  const prefs = await getUserPreferences(uid);
  
  if (!prefs.savedFilters || !prefs.savedFilters[filterId]) {
    throw new Error('Filter not found');
  }

  const userRef = db.collection('users').doc(uid);
  
  await userRef.set({
    preferences: {
      savedFilters: {
        [filterId]: admin.firestore.FieldValue.delete()
      }
    }
  }, { merge: true });

  return { success: true };
}

async function getRecommendedCategories(userCategories = [], age = null, gender = null) {
  const popularCategories = [
    'Health/Mental Health',
    'Career/Career Growth',
    'Relationships/Marriage',
    'Parenting',
    'Finance/Investing',
    'Wellness/Yoga'
  ];

  const ageBasedCategories = {
    '20-25': ['Career/Career Growth', 'Education/Skills', 'Relationships/Dating'],
    '25-35': ['Career/Work-Life Balance', 'Relationships/Marriage', 'Finance/Investing', 'Parenting/Newborn'],
    '35-45': ['Parenting', 'Career/Leadership', 'Finance/Budgeting', 'Health/Mental Health'],
    '45+': ['Health/Menopause', 'Finance/Investing', 'Wellness/Yoga', 'Lifestyle/Travel']
  };

  let recommendations = [];

  if (userCategories && userCategories.length > 0) {
    recommendations = VALID_CATEGORIES.filter(cat => !userCategories.includes(cat)).slice(0, 6);
  } else if (age) {
    const ageGroup = age < 25 ? '20-25' : age < 35 ? '25-35' : age < 45 ? '35-45' : '45+';
    recommendations = ageBasedCategories[ageGroup] || popularCategories;
  } else {
    recommendations = popularCategories;
  }

  return recommendations.map(category => ({
    category,
    isSeed: false
  }));
}

async function seedDemoPreferences(uid) {
  const demoPreferences = {
    followedCategories: [
      'Health/Mental Health',
      'Career/Career Growth',
      'Parenting'
    ],
    savedFilters: {
      [uuidv4()]: {
        id: uuidv4(),
        name: 'My Parenting Stories',
        type: 'stories',
        query: {
          category: 'Parenting',
          tags: ['postpartum'],
          sort: 'newest',
          pageSize: 12
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      [uuidv4()]: {
        id: uuidv4(),
        name: 'Career Growth Posts',
        type: 'community',
        query: {
          category: 'Career/Career Growth',
          sort: 'top',
          pageSize: 20
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    },
    discoverySettings: {
      age: 28,
      interests: ['career', 'parenting', 'health']
    },
    isSeed: 'demo'
  };

  const userRef = db.collection('users').doc(uid);
  
  await userRef.set({
    preferences: demoPreferences
  }, { merge: true });

  return demoPreferences;
}

module.exports = {
  VALID_CATEGORIES,
  VALID_FILTER_TYPES,
  validateCategory,
  validateFilterQuery,
  getUserPreferences,
  updateUserPreferences,
  followCategory,
  unfollowCategory,
  createSavedFilter,
  updateSavedFilter,
  deleteSavedFilter,
  getRecommendedCategories,
  seedDemoPreferences
};
