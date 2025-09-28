"use strict";
/**
 * Firebase Cloud Functions for Femina Platform
 * Main entry point and route handler
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupUserData = exports.processSignUp = exports.api = void 0;
const firebase_functions_1 = require("firebase-functions");
const app_1 = require("firebase-admin/app");
// Initialize Firebase Admin FIRST, before any other imports
(0, app_1.initializeApp)();
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const auth_1 = require("./middleware/auth");
const rateLimit_1 = require("./middleware/rateLimit");
// Import route handlers
const auth_2 = require("./routes/auth");
const posts_1 = require("./routes/posts");
const feed_1 = require("./routes/feed");
const ai_1 = require("./routes/ai");
const experts_1 = require("./routes/experts");
const bookings_1 = require("./routes/bookings");
const marketplace_1 = require("./routes/marketplace");
const payments_1 = require("./routes/payments");
const resources_1 = require("./routes/resources");
const moderation_1 = require("./routes/moderation");
const uploads_1 = require("./routes/uploads");
// Create Express app
const app = (0, express_1.default)();
// after: const app = express();
app.set('trust proxy', true); // <-- important for req.ip behind the emulator/proxy
// Middleware
app.use((0, cors_1.default)({ origin: true }));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
// Apply rate limiting
app.use(rateLimit_1.rateLimiter);
// Health check endpoint
app.get('/v1/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});
// Health check endpoint (also support root for compatibility)
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});
// Public routes (no auth required)
app.use('/v1/auth', auth_2.authRoutes);
app.use('/v1/resources', resources_1.resourcesRoutes);
// Protected routes (auth required)
app.use('/v1/posts', auth_1.authMiddleware, posts_1.postsRoutes);
app.use('/v1/feed', auth_1.authMiddleware, feed_1.feedRoutes);
app.use('/v1/ai', auth_1.authMiddleware, ai_1.aiRoutes);
app.use('/v1/experts', auth_1.authMiddleware, experts_1.expertsRoutes);
app.use('/v1/bookings', auth_1.authMiddleware, bookings_1.bookingsRoutes);
app.use('/v1/marketplace', auth_1.authMiddleware, marketplace_1.marketplaceRoutes);
app.use('/v1/payments', auth_1.authMiddleware, payments_1.paymentsRoutes);
app.use('/v1/uploads', auth_1.authMiddleware, uploads_1.uploadsRoutes);
// Admin-only routes
app.use('/v1/moderation', auth_1.authMiddleware, auth_1.adminOnly, moderation_1.moderationRoutes);
// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.originalUrl} not found`,
        timestamp: new Date().toISOString()
    });
});
// Global error handler
app.use((error, req, res, next) => {
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
exports.api = firebase_functions_1.https.onRequest(app);
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
exports.processSignUp = firebase_functions_1.auth.user().onCreate(async (user) => {
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
    }
    catch (error) {
        console.error('Error creating user profile:', error);
    }
});
exports.cleanupUserData = firebase_functions_1.auth.user().onDelete(async (user) => {
    const { uid } = user;
    const db = require('firebase-admin/firestore').getFirestore();
    try {
        // Delete user profile
        await db.collection('users').doc(uid).delete();
        // Delete user's posts
        const postsQuery = await db.collection('posts').where('authorId', '==', uid).get();
        const batch = db.batch();
        postsQuery.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`User data cleaned up for ${uid}`);
    }
    catch (error) {
        console.error('Error cleaning up user data:', error);
    }
});
//# sourceMappingURL=index.js.map