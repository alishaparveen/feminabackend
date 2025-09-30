const { google } = require('googleapis');

const API_KEY = process.env.PERSPECTIVE_API_KEY;
const DISCOVERY_URL = 'https://commentanalyzer.googleapis.com/$discovery/rest?version=v1alpha1';

let perspectiveClient = null;

const initializePerspectiveClient = async () => {
  if (!API_KEY) {
    console.warn('⚠️  PERSPECTIVE_API_KEY not found - comment moderation will be disabled');
    return null;
  }

  try {
    perspectiveClient = await google.discoverAPI(DISCOVERY_URL);
    console.log('✅ Perspective API client initialized');
    return perspectiveClient;
  } catch (error) {
    console.error('Failed to initialize Perspective API client:', error);
    return null;
  }
};

const analyzeComment = async (text, attributes = ['TOXICITY']) => {
  if (!text || typeof text !== 'string') {
    throw new Error('Comment text is required and must be a string');
  }

  if (!perspectiveClient) {
    await initializePerspectiveClient();
  }

  if (!perspectiveClient) {
    console.warn('Perspective API not available - skipping moderation');
    return {
      scores: {},
      highestScore: 0,
      flagged: false,
      reasons: []
    };
  }

  const requestedAttributes = {};
  attributes.forEach(attr => {
    requestedAttributes[attr.toUpperCase()] = {};
  });

  const analyzeRequest = {
    comment: { text },
    requestedAttributes,
    languages: ['en']
  };

  try {
    const response = await perspectiveClient.comments.analyze({
      key: API_KEY,
      resource: analyzeRequest
    });

    const attributeScores = response.data.attributeScores || {};
    const scores = {};
    let highestScore = 0;
    const reasons = [];

    for (const [attribute, data] of Object.entries(attributeScores)) {
      const score = data.summaryScore?.value || 0;
      scores[attribute] = score;
      
      if (score > highestScore) {
        highestScore = score;
      }

      if (score > 0.7) {
        reasons.push(attribute.toLowerCase());
      }
    }

    return {
      scores,
      highestScore,
      flagged: highestScore > 0.7,
      reasons,
      languages: response.data.languages || [],
      detectedLanguages: response.data.detectedLanguages || []
    };
  } catch (error) {
    console.error('Perspective API analysis error:', error.message);
    
    if (error.response?.data?.error) {
      console.error('API Error details:', error.response.data.error);
    }

    return {
      scores: {},
      highestScore: 0,
      flagged: false,
      reasons: [],
      error: error.message
    };
  }
};

const analyzeCommentWithMultipleAttributes = async (text) => {
  return analyzeComment(text, [
    'TOXICITY',
    'SEVERE_TOXICITY',
    'IDENTITY_ATTACK',
    'INSULT',
    'PROFANITY',
    'THREAT'
  ]);
};

module.exports = {
  initializePerspectiveClient,
  analyzeComment,
  analyzeCommentWithMultipleAttributes
};
