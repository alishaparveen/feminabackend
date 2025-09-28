🚀 Femina Backend Deployment Guide
📋 Pre-Deployment Checklist
 Firebase project created with billing enabled
 Firebase CLI installed (npm install -g firebase-tools)
 Node.js 18+ installed
 Stripe account with API keys
 Google AI Studio account with Gemini API key
🏗️ Setup Instructions
1. Project Setup
bash
# Clone/create your project directory
mkdir femina-backend && cd femina-backend

# Initialize Firebase project
firebase login
firebase init

# Select: Functions, Firestore, Storage
# Choose TypeScript for Functions
# Install dependencies now: Yes
2. Install Dependencies
bash
cd functions
npm install
3. Environment Configuration
For Local Development:
Create functions/.env.local:

env
GEMINI_API_KEY=your_gemini_api_key
STRIPE_SECRET_KEY=sk_test_your_test_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
FUNCTIONS_EMULATOR=true
For Production:
bash
firebase functions:config:set gemini.api_key="your_prod_gemini_key"
firebase functions:config:set stripe.secret_key="sk_live_your_live_key" 
firebase functions:config:set stripe.webhook_secret="whsec_your_prod_webhook"
firebase functions:config:set app.domain="yourdomain.com"
firebase functions:config:set app.environment="production"
4. Database Setup
bash
# Deploy Firestore rules first
firebase deploy --only firestore:rules

# Deploy storage rules
firebase deploy --only storage
5. Function Deployment
bash
# Build and deploy functions
npm run build
firebase deploy --only functions

# Or deploy specific function
firebase deploy --only functions:api
🧪 Local Development
Start Emulators
bash
# From project root
firebase emulators:start

# Your services will be available at:
# - Functions: http://localhost:5001/your-project/us-central1/api
# - Firestore: http://localhost:8080
# - Auth: http://localhost:9099
# - Storage: http://localhost:9199
# - Emulator UI: http://localhost:4000
Test API Endpoints
bash
# Health check
curl http://localhost:5001/your-project/us-central1/api/health

# Test with authentication (replace with real token)
curl -H "Authorization: Bearer YOUR_ID_TOKEN" \
     http://localhost:5001/your-project/us-central1/api/posts
🔧 Production Configuration
1. Domain Setup
bash
# Custom domain (optional)
firebase hosting:channel:deploy live
2. Stripe Webhooks
Go to Stripe Dashboard > Webhooks
Add endpoint: https://your-region-your-project.cloudfunctions.net/api/payments/webhook
Select events:
payment_intent.succeeded
payment_intent.payment_failed
invoice.payment_succeeded
customer.subscription.updated
Copy webhook secret to Firebase config
3. Security Configuration
bash
# Set CORS origins
firebase functions:config:set app.cors_origins="https://yourdomain.com,https://www.yourdomain.com"

# Set rate limiting
firebase functions:config:set security.rate_limit="100"
firebase functions:config:set security.window_ms="900000"
4. Monitoring Setup
bash
# Enable error reporting
firebase functions:config:set monitoring.error_reporting="true"

# Set up alerts (optional)
firebase functions:config:set monitoring.slack_webhook="your_slack_webhook"
🔐 Security Checklist
 API Keys: All sensitive keys in Firebase Functions config
 CORS: Origins restricted to your domains
 Rate Limiting: Enabled on all public endpoints
 Authentication: Required for protected endpoints
 Input Validation: Zod schemas on all inputs
 File Upload: Size and type restrictions enabled
 Firestore Rules: Deployed and tested
 Admin Access: Properly restricted admin-only routes
📊 Post-Deployment Testing
1. API Health Checks
bash
# Production health check
curl https://your-region-your-project.cloudfunctions.net/api/health

# Test authentication flow
# (Use Firebase Auth to get ID token, then test protected endpoints)
2. Database Operations
Create test user account
Post test content
Test AI chat functionality
Verify file uploads work
Test payment flow (with Stripe test mode)
3. Security Testing
Verify unauthorized access is blocked
Test rate limiting triggers
Confirm file upload restrictions work
Validate input sanitization
🐛 Troubleshooting
Common Issues
Functions not deploying:

bash
# Check for TypeScript errors
npm run build

# Check function logs
firebase functions:log

# Verify dependencies
npm install && npm audit
Authentication failures:

bash
# Check token validity
# Verify Firestore rules allow the operation
# Confirm user exists in database
Database permission errors:

bash
# Redeploy Firestore rules
firebase deploy --only firestore:rules

# Check rule syntax
firebase firestore:rules:get
Payment integration issues:

bash
# Verify Stripe keys in config
firebase functions:config:get

# Check webhook endpoint is accessible
# Validate webhook signatures
📈 Performance Optimization
Function Configuration
bash
# Set memory allocation
firebase functions:config:set runtime.memory="512MB"

# Set timeout
firebase functions:config:set runtime.timeout="60s"

# Enable concurrency
firebase functions:config:set runtime.concurrency="80"
Database Optimization
Monitor Firestore usage in console
Create composite indexes for complex queries
Implement pagination for large datasets
Use subcollections for hierarchical data
Monitoring & Alerts
bash
# View function logs
firebase functions:log --only api

# Monitor performance
# Check Firebase Console > Functions > Metrics

# Set up billing alerts
# Firebase Console > Usage and billing
🚀 Go Live Checklist
Before Launch:
 All environment variables configured for production
 Stripe live keys configured and tested
 Domain pointing to Firebase Hosting (if using)
 SSL certificates active
 Error monitoring configured
 Backup strategy in place
 Performance benchmarks established
After Launch:
 Monitor function execution metrics
 Watch error rates and logs
 Track database read/write usage
 Monitor payment processing
 Review security logs
 Set up automated health checks
📞 Support Resources
Firebase Documentation: https://firebase.google.com/docs
Stripe Documentation: https://stripe.com/docs
Function Logs: firebase functions:log
Firebase Console: https://console.firebase.google.com
Stripe Dashboard: https://dashboard.stripe.com
🎉 Your Femina backend is now ready for production!

Remember to regularly monitor performance, update dependencies, and review security practices as your platform grows.

