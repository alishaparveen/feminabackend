/**
 * Standalone Express server for Replit deployment
 * This runs your Firebase Cloud Function locally as a regular Express app
 */
require('dotenv').config();

// Initialize Firebase FIRST
require('./firebase-wrapper');

// Create Express server directly (same as Firebase Function)  
const express = require('express');
const cors = require('cors');

// Import middleware and routes AFTER Firebase initialization
const { authMiddleware, adminOnly } = require('./functions/lib/middleware/auth');
const { rateLimiter } = require('./functions/lib/middleware/rateLimit');

// Import route handlers
const { authRoutes } = require('./functions/lib/routes/auth');
const { postsRoutes } = require('./functions/lib/routes/posts');
const { feedRoutes } = require('./functions/lib/routes/feed');
const { aiRoutes } = require('./functions/lib/routes/ai');
const { expertsRoutes } = require('./functions/lib/routes/experts');
const { bookingsRoutes } = require('./functions/lib/routes/bookings');
const { marketplaceRoutes } = require('./functions/lib/routes/marketplace');
const { paymentsRoutes } = require('./functions/lib/routes/payments');
const { resourcesRoutes } = require('./functions/lib/routes/resources');
const { moderationRoutes } = require('./functions/lib/routes/moderation');
const { uploadsRoutes } = require('./functions/lib/routes/uploads');

// Create Express app (same as Firebase Function)
const app = express();
app.set('trust proxy', true);

// Middleware
app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(rateLimiter);

// Health check endpoints
app.get('/v1/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

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

const PORT = process.env.PORT || 5000;

console.log(`🚀 Starting Femina Backend Server on port ${PORT}`);
console.log(`📍 API available at: http://localhost:${PORT}`);
console.log(`🔥 Firebase project: ${process.env.FIREBASE_SERVICE_ACCOUNT_KEY ? 'Connected with service account' : 'Using default credentials'}`);

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Femina Backend is running on http://0.0.0.0:${PORT}`);
  console.log(`📋 Available endpoints:`);
  console.log(`   GET  /v1/health`);
  console.log(`   GET  /v1/resources`);  
  console.log(`   POST /v1/posts`);
  console.log(`   POST /v1/auth`);
  console.log(`   And more...`);
});