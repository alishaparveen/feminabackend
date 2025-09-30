const admin = require('firebase-admin');
const db = admin.firestore();

const CATEGORIES_CONFIG = [
  {
    category: 'Health',
    subCategories: ['Mental Health', 'PCOS', 'Fertility', 'Pregnancy', 'Fitness', 'Nutrition', 'Women\'s Health']
  },
  {
    category: 'Career',
    subCategories: ['Job Search', 'Workplace', 'Entrepreneurship', 'Skill Development', 'Salary Negotiation', 'Leadership']
  },
  {
    category: 'Relationships',
    subCategories: ['Dating', 'Marriage', 'Family', 'Friendship', 'Communication', 'Boundaries']
  },
  {
    category: 'Parenting',
    subCategories: ['Pregnancy', 'Newborn', 'Toddlers', 'School Age', 'Teenagers', 'Work-Life Balance']
  },
  {
    category: 'Finance',
    subCategories: ['Budgeting', 'Investing', 'Savings', 'Debt', 'Financial Planning', 'Side Hustles']
  },
  {
    category: 'Lifestyle',
    subCategories: ['Fashion', 'Beauty', 'Travel', 'Hobbies', 'Home', 'Self Care']
  },
  {
    category: 'Education',
    subCategories: ['Higher Education', 'Online Learning', 'Certifications', 'Scholarships', 'Study Tips']
  },
  {
    category: 'Support',
    subCategories: ['Mental Health Support', 'Crisis', 'Grief', 'Abuse', 'Addiction', 'General Support']
  },
  {
    category: 'Uncategorized',
    subCategories: []
  }
];

const getTopics = async (req, res) => {
  try {
    const { includeCounts } = req.query;
    
    let topics = [...CATEGORIES_CONFIG];

    if (includeCounts === 'true') {
      const metaDoc = await db.collection('meta').doc('storyCategoryCounts').get();
      
      if (metaDoc.exists) {
        const counts = metaDoc.data();
        topics = topics.map(topic => ({
          ...topic,
          count: counts[topic.category] || 0
        }));
      } else {
        const snapshot = await db.collection('stories').get();
        const categoryCounts = {};
        
        snapshot.forEach(doc => {
          const category = doc.data().category || 'Uncategorized';
          categoryCounts[category] = (categoryCounts[category] || 0) + 1;
        });
        
        topics = topics.map(topic => ({
          ...topic,
          count: categoryCounts[topic.category] || 0
        }));
      }
    }

    res.json({
      success: true,
      data: {
        topics
      }
    });

  } catch (error) {
    console.error('Error fetching topics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch topics',
      message: error.message
    });
  }
};

const getCategoryCounts = async (req, res) => {
  try {
    const metaDoc = await db.collection('meta').doc('storyCategoryCounts').get();
    
    if (metaDoc.exists) {
      const counts = metaDoc.data();
      return res.json({
        success: true,
        data: {
          counts
        }
      });
    }

    const snapshot = await db.collection('stories').get();
    const counts = {};
    
    snapshot.forEach(doc => {
      const category = doc.data().category || 'Uncategorized';
      counts[category] = (counts[category] || 0) + 1;
    });

    await db.collection('meta').doc('storyCategoryCounts').set(counts);

    res.json({
      success: true,
      data: {
        counts
      }
    });

  } catch (error) {
    console.error('Error fetching category counts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch category counts',
      message: error.message
    });
  }
};

module.exports = {
  getTopics,
  getCategoryCounts
};
