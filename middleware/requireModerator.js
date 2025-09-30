const admin = require('firebase-admin');
const db = admin.firestore();

const requireModerator = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required', 
        message: 'Please authenticate first' 
      });
    }

    const isModerator = req.user.customClaims?.moderator === true;
    const isAdmin = req.user.customClaims?.role === 'admin' || req.user.role === 'admin';
    
    if (isModerator || isAdmin) {
      return next();
    }

    const moderatorDoc = await db.collection('moderators').doc(req.user.uid).get();
    if (moderatorDoc.exists) {
      return next();
    }

    return res.status(403).json({ 
      error: 'Moderator access required', 
      message: 'You do not have moderator privileges' 
    });
  } catch (error) {
    console.error('Moderator check error:', error);
    return res.status(500).json({ 
      error: 'Authorization check failed', 
      message: error.message 
    });
  }
};

module.exports = requireModerator;
