const admin = require('firebase-admin');

const db = admin.firestore();

const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required', message: 'Missing or invalid authorization header' });
    }

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
      role: userData.role || 'user',
      customClaims: decodedToken
    };
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Authentication failed', message: 'Invalid token' });
  }
};

module.exports = { authenticateUser };
