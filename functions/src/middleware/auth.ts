/**
 * Authentication Middleware for Femina Platform
 */

import { Request, Response, NextFunction } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    role?: string;
    verified?: boolean;
  };
}

/**
 * Middleware to verify Firebase ID token
 */
export const authMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No valid authorization token provided'
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    // Verify the ID token
    const decodedToken = await getAuth().verifyIdToken(idToken);
    
    // Get additional user data from Firestore
    const db = getFirestore();
    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    const userData = userDoc.data();

    // Attach user info to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      role: userData?.role || 'user',
      verified: userData?.verified || false
    };

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token'
    });
  }
};

/**
 * Middleware to check if user has admin role
 */
export const adminOnly = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Admin access required'
    });
  }
  next();
};

/**
 * Middleware to check if user has expert role or higher
 */
export const expertOnly = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user || !['expert', 'admin'].includes(req.user.role || '')) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Expert access required'
    });
  }
  next();
};

/**
 * Middleware to check if user has moderator role or higher  
 */
export const moderatorOnly = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user || !['moderator', 'admin'].includes(req.user.role || '')) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Moderator access required'
    });
  }
  next();
};