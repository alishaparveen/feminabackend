/**
 * Firebase Cloud Functions for Femina Platform
 * Main entry point and route handler
 */

import { https, auth } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';

// Initialize Firebase Admin FIRST, before any other imports
initializeApp();

import express from 'express';
import cors from 'cors';
import { authMiddleware, adminOnly } from './middleware/auth';
import { validateRequest } from './middleware/validation';
import { rateLimiter } from './middleware/rateLimit';

// Import route handlers
import { authRoutes } from './routes/auth';
import { postsRoutes } from './routes/posts';
import { feedRoutes } from './routes/feed';
import { aiRoutes } from './routes/ai';
import { expertsRoutes } from './routes/experts';
import { bookingsRoutes } from './routes/bookings';
import { marketplaceRoutes } from './routes/marketplace';
import { paymentsRoutes } from './routes/payments';
import { resourcesRoutes } from './routes/resources';
import { moderationRoutes } from './routes/moderation';
import { uploadsRoutes } from './routes/uploads';

// Create Express app
const app = express();
// after: const app = express();
app.set('trust proxy', true); // <-- important for req.ip behind the emulator/proxy

// Middleware
app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Apply rate limiting
app.use(rateLimiter);

// Health check endpoint
app.get('/v1/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Health check endpoint (also support root for compatibility)
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Public routes (no auth required)
app.use('/v1/auth', authRoutes);
app.use('/v1/resources', resourcesRoutes);

// Protected routes (auth required)
app.use('/v1/posts', authMiddleware, postsRoutes);
app.use('/v1/feed', authMiddleware, feedRoutes);
app.use('/v1/ai', authMiddleware, aiRoutes);
app.use('/v1/experts', authMiddleware, expertsRoutes);
app.use('/v1/bookings', authMiddleware, bookingsRoutes);
app.use('/v1/marketplace', authMiddleware, marketplaceRoutes);
app.use('/v1/payments', authMiddleware, paymentsRoutes);
app.use('/v1/uploads', authMiddleware, uploadsRoutes);

// Admin-only routes
app.use('/v1/moderation', authMiddleware, adminOnly, moderationRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error handler:', error);
  
  const statusCode = error.statusCode || 500;
  const message = error.message || 'Internal Server Error';
  
  res.status(statusCode).json({
    error: error.name || 'ServerError',
    message,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// Export the Express app as a Cloud Function
export const api = https.onRequest(app);

// Firestore triggers for real-time features
/*
export { onPostCreated, onPostUpdated, onPostDeleted } from './triggers/posts';
export { onUserCreated, onUserDeleted } from './triggers/users';
export { onBookingCreated, onBookingStatusChanged } from './triggers/bookings';
export { onModerationReportCreated } from './triggers/moderation';
export { onPaymentSucceeded } from './triggers/payments';

// Scheduled functions
export { dailyFeedGeneration } from './scheduled/feedGeneration';
export { weeklyAnalytics } from './scheduled/analytics';
export { cleanupExpiredSessions } from './scheduled/cleanup';
*/

// Authentication triggers
export const processSignUp = auth.user().onCreate(async (user) => {
  const { uid, email, displayName, photoURL } = user;
  
  const db = require('firebase-admin/firestore').getFirestore();
  
  try {
    await db.collection('users').doc(uid).set({
      uid,
      email: email || null,
      displayName: displayName || 'Anonymous User',
      photoURL: photoURL || null,
      role: 'user',
      verified: false,
      createdAt: new Date(),
      lastActive: new Date(),
      settings: {
        notifications: {
          email: true,
          push: true,
          marketing: false
        },
        privacy: {
          profileVisibility: 'public',
          showOnlineStatus: true
        }
      }
    });
    
    console.log(`User profile created for ${uid}`);
  } catch (error) {
    console.error('Error creating user profile:', error);
  }
});

export const cleanupUserData = auth.user().onDelete(async (user) => {
  const { uid } = user;
  const db = require('firebase-admin/firestore').getFirestore();
  
  try {
    // Delete user profile
    await db.collection('users').doc(uid).delete();
    
    // Delete user's posts
    const postsQuery = await db.collection('posts').where('authorId', '==', uid).get();
    const batch = db.batch();
    
    postsQuery.docs.forEach((doc: any) => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    
    console.log(`User data cleaned up for ${uid}`);
  } catch (error) {
    console.error('Error cleaning up user data:', error);
  }
});