Femina Platform - Firebase Backend
This is the Firebase serverless backend for the Femina platform, providing API endpoints for community features, AI assistance, expert consultations, and marketplace functionality.

🏗️ Architecture
Firebase Cloud Functions (TypeScript) - API endpoints and business logic
Firestore - NoSQL database for user data, posts, bookings, etc.
Firebase Storage - File uploads (images, documents)
Firebase Authentication - User authentication and authorization
Stripe - Payment processing integration
📁 Project Structure
functions/
├── src/
│   ├── index.ts              # Main entry point and route setup
│   ├── routes/
│   │   ├── ai.ts             # AI assistant endpoints
│   │   ├── auth.ts           # Authentication routes
│   │   ├── posts.ts          # Community posts
│   │   ├── feed.ts           # Personalized feeds
│   │   ├── experts.ts        # Expert profiles
│   │   ├── bookings.ts       # Consultation bookings
│   │   ├── marketplace.ts    # Product listings
│   │   ├── payments.ts       # Payment processing
│   │   ├── moderation.ts     # Content moderation
│   │   ├── uploads.ts        # File uploads
│   │   └── resources.ts      # Educational content
│   ├── middleware/
│   │   ├── auth.ts           # Authentication middleware
│   │   ├── validation.ts     # Request validation
│   │   └── rateLimit.ts      # Rate limiting
│   ├── triggers/
│   │   ├── posts.ts          # Post-related triggers
│   │   ├── users.ts          # User lifecycle triggers
│   │   ├── bookings.ts       # Booking notifications
│   │   ├── moderation.ts     # Auto-moderation
│   │   └── payments.ts       # Payment webhooks
│   ├── scheduled/
│   │   ├── feedGeneration.ts # Daily feed updates
│   │   ├── analytics.ts      # Weekly reports
│   │   └── cleanup.ts        # Data cleanup tasks
│   └── types/
│       ├── auth.ts           # Authentication types
│       ├── api.ts            # API response types
│       └── database.ts       # Database schema types
├── package.json
├── tsconfig.json
└── .env.local               # Environment variables
firestore.rules              # Firestore security rules
🚀 Getting Started
Prerequisites
Node.js 18+ and npm
Firebase CLI (npm install -g firebase-tools)
Firebase project with billing enabled
Stripe account for payments
Google AI Studio account for Gemini API
Initial Setup
Clone and install dependencies:
bash
cd functions
npm install
Firebase Configuration:
bash
# Login to Firebase
firebase login

# Set your project ID
firebase use --add your-project-id

# Initialize Firebase (if not done)
firebase init functions,firestore,storage
Environment Variables: Set up the required environment variables:
bash
# Set Gemini API key for AI features
firebase functions:config:set gemini.api_key="YOUR_GEMINI_API_KEY"

# Set Stripe keys for payments
firebase functions:config:set stripe.secret_key="YOUR_STRIPE_SECRET_KEY"
firebase functions:config:set stripe.webhook_secret="YOUR_STRIPE_WEBHOOK_SECRET"

# Set other configuration
firebase functions:config:set app.domain="your-domain.com"
firebase functions:config:set app.environment="development"
Firestore Setup:
bash
# Deploy Firestore rules
firebase deploy --only firestore:rules

# Optional: Import sample data
firebase firestore:delete --all-collections  # Only for fresh setup
# Then run your data import scripts
🧪 Development
Run Emulators Locally
bash
# Start Firebase emulators
firebase emulators:start

# The following services will be available:
# - Functions: http://localhost:5001/your-project/us-central1/api
# - Firestore: http://localhost:8080
# - Auth: http://localhost:9099
# - Storage: http://localhost:9199
Environment Variables for Local Development
Create functions/.env.local:

env
# DO NOT COMMIT REAL SECRETS - Use placeholders
GEMINI_API_KEY=your_gemini_api_key_here
STRIPE_SECRET_KEY=sk_test_your_stripe_test_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
FUNCTIONS_EMULATOR=true
Testing API Endpoints
bash
# Health check
curl http://localhost:5001/your-project/us-central1/api/health

# Test authentication required endpoint (need to include Authorization header)
curl -H "Authorization: Bearer YOUR_ID_TOKEN" \
     http://localhost:5001/your-project/us-central1/api/posts
🏭 Production Deployment
Deploy Functions
bash
# Deploy all functions
firebase deploy --only functions

# Deploy specific function
firebase deploy --only functions:api

# Deploy with specific runtime
firebase functions:config:set runtime.memory="512MB"
firebase functions:config:set runtime.timeout="60s"
Deploy Database Rules
bash
# Deploy Firestore rules
firebase deploy --only firestore:rules

# Deploy Storage rules  
firebase deploy --only storage
Production Configuration
Set production environment variables:

bash
# Production Gemini API key
firebase functions:config:set gemini.api_key="prod_gemini_key" --project=your-prod-project

# Production Stripe keys
firebase functions:config:set stripe.secret_key="sk_live_..." --project=your-prod-project
firebase functions:config:set stripe.webhook_secret="whsec_..." --project=your-prod-project

# App configuration
firebase functions:config:set app.domain="femina.app" --project=your-prod-project
firebase functions:config:set app.environment="production" --project=your-prod-project
🔐 Security Checklist
 Firestore Rules: Deployed and tested
 Environment Variables: All secrets configured via Firebase config
 CORS: Properly configured for your domain
 Rate Limiting: Enabled for all public endpoints
 Input Validation: All endpoints use Zod validation schemas
 Authentication: All protected routes use auth middleware
 Admin Routes: Properly restricted to admin users only
 File Uploads: Size limits and type validation in place
 Payment Security: Stripe webhooks verified
📊 Monitoring and Logs
View Logs
bash
# View function logs
firebase functions:log

# View specific function logs
firebase functions:log --only api

# Stream logs in real-time
firebase functions:log --only api --follow
Performance Monitoring
Enable Firebase Performance Monitoring in console
Set up alerts for function failures and high latency
Monitor Firestore usage and billing
🔧 Configuration
Function Runtime Options
Functions are configured with the following defaults:

Memory: 512MB (configurable per function)
Timeout: 60 seconds
Runtime: Node.js 18
Region: us-central1
Database Schema
Key Firestore collections:

/users/{uid} - User profiles and settings
/posts/{postId} - Community posts
/experts/{expertId} - Expert profiles
/bookings/{bookingId} - Consultation bookings
/products/{productId} - Marketplace items
/payments/{paymentId} - Payment records
/conversations/{userId} - AI chat history
/moderationQueue/{reportId} - Content reports
🚨 Manual Setup Steps Required
After deployment, complete these manual steps:

Stripe Webhook Setup:
Go to Stripe Dashboard > Webhooks
Add endpoint: https://your-region-your-project.cloudfunctions.net/api/payments/webhook
Select events: payment_intent.succeeded, payment_intent.payment_failed, invoice.payment_succeeded
Copy webhook secret to Firebase config
Firebase Authentication:
Enable sign-in methods in Firebase Console
Configure OAuth providers (Google, Apple, etc.)
Set up custom claims for admin/expert roles
Storage CORS:
bash
   gsutil cors set storage-cors.json gs://your-project.appspot.com
Firestore Indexes:
Deploy will prompt for required indexes
Monitor console for any missing indexes
Domain Configuration:
Set up custom domain if needed
Configure SSL certificates
Update CORS origins
📈 Scaling Considerations
Functions: Auto-scale, monitor concurrent executions
Firestore: Monitor read/write usage, optimize queries
Storage: Implement CDN for frequently accessed files
AI API: Monitor Gemini API quotas and costs
Payments: Stripe scales automatically
🐛 Troubleshooting
Common Issues
Functions not deploying:

Check Node.js version compatibility
Verify all dependencies are installed
Check for TypeScript errors: npm run build
Authentication errors:

Verify ID tokens are valid and not expired
Check Firestore rules match your authentication logic
Ensure custom claims are set correctly for admin users
Payment issues:

Verify Stripe keys in Firebase config
Check webhook endpoint is accessible
Validate webhook signatures
AI API failures:

Check Gemini API key is valid
Monitor API quotas and limits
Verify request format matches expected schema
Debug Mode
Enable debug logging:

bash
# Set debug logging level
firebase functions:config:set app.log_level="debug"
firebase deploy --only functions
📞 Support
For issues and questions:

Check the troubleshooting section above
Review Firebase Functions logs
Check Firestore rules and indexes
Verify environment variable configuration
⚠️ Important Security Notes:

Never commit real API keys or secrets to version control
Always use Firebase Functions config for sensitive data
Regularly rotate API keys and webhook secrets
Monitor access logs for suspicious activity
