/**
 * Simple Express server for testing deployment
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// Basic middleware
app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// API ROUTES FIRST (as per your guidance)
app.get('/v1/health', (req, res) => {
  res.json({ 
    ok: true,
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    message: 'Femina Backend API is running!' 
  });
});

// Root endpoint for deployment verification
app.get('/', (req, res) => {
  res.type('text').send('Femina API - Backend Running');
});

// Test endpoints
app.get('/v1/test', (req, res) => {
  res.json({
    message: 'API endpoints are working!',
    endpoints: [
      'GET /v1/health',
      'GET /v1/resources',
      'POST /v1/posts',
      'POST /v1/auth'
    ]
  });
});

app.get('/v1/resources', (req, res) => {
  res.json({
    success: true,
    data: {
      resources: [
        {
          id: '1',
          title: 'Sample Resource',
          description: 'Test resource for API validation',
          category: 'test'
        }
      ],
      pagination: {
        currentPage: 1,
        hasMore: false
      }
    }
  });
});

// 404 handler  
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    timestamp: new Date().toISOString(),
    availableEndpoints: ['/v1/health', '/v1/test', '/v1/resources']
  });
});

const PORT = process.env.PORT || 5000;

console.log(`🚀 Starting Simple Femina Backend Server on port ${PORT}`);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Femina Backend is running on http://0.0.0.0:${PORT}`);
  console.log(`📋 Available endpoints:`);
  console.log(`   GET  /v1/health - Health check`);
  console.log(`   GET  /v1/test - API test`);
  console.log(`   GET  /v1/resources - Sample resources`);
  console.log(`🌐 Backend ready for frontend connection!`);
});