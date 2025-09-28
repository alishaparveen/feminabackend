# Femina Platform - Firebase Backend

This is the Firebase serverless backend for the Femina platform, providing API endpoints for community features, AI assistance, expert consultations, and marketplace functionality.

## 🏗️ Architecture
- **Firebase Cloud Functions (TypeScript)** - API endpoints and business logic
- **Firestore** - NoSQL database for user data, posts, bookings, etc.
- **Firebase Storage** - File uploads (images, documents)
- **Firebase Authentication** - User authentication and authorization
- **Stripe** - Payment processing integration

## 📁 Project Structure
```
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
│   │   ├── moderation.ts    # Content moderation
│   │   ├── uploads.ts        # File uploads
│   │   └── resources.ts      # Educational content
│   ├── middleware/
│   │   ├── auth.ts           # Authentication middleware
│   │   ├── validation.ts     # Request validation
│   │   └── rateLimit.ts      # Rate limiting
│   └── types/
│       └── auth.ts           # Authentication types
├── package.json
├── tsconfig.json
└── .env.local               # Environment variables
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm
- Firebase CLI (`npm install -g firebase-tools`)
- Firebase project with billing enabled
- Stripe account for payments
- Google AI Studio account for Gemini API

### Initial Setup

1. **Clone and install dependencies:**
   ```bash
   cd functions
   npm install
   ```

2. **Firebase Configuration:**
   ```bash
   # Login to Firebase
   firebase login
   
   # Set your project ID
   firebase use --add your-project-id
   
   # Initialize Firebase (if not done)
   firebase init functions,firestore,storage
   ```

3. **Environment Variables:** Set up the required environment variables:
   ```bash
   # Set Gemini API key for AI features
   firebase functions:config:set gemini.api_key="YOUR_GEMINI_API_KEY"
   
   # Set Stripe keys for payments
   firebase functions:config:set stripe.secret_key="YOUR_STRIPE_SECRET_KEY"
   firebase functions:config:set stripe.webhook_secret="YOUR_STRIPE_WEBHOOK_SECRET"
   
   # Set other configuration
   firebase functions:config:set app.domain="your-domain.com"
   firebase functions:config:set app.environment="development"
   ```

4. **Firestore Setup:**
   ```bash
   # Deploy Firestore rules
   firebase deploy --only firestore:rules
   ```

## 🧪 Development

### Run Emulators Locally
```bash
# Start Firebase emulators
firebase emulators:start

# The following services will be available:
# - Functions: http://localhost:5001/your-project/us-central1/api
# - Firestore: http://localhost:8080
# - Auth: http://localhost:9099
# - Storage: http://localhost:9199
```

### Environment Variables for Local Development
Create `functions/.env.local`:
```env
# DO NOT COMMIT REAL SECRETS - Use placeholders
GEMINI_API_KEY=your_gemini_api_key_here
STRIPE_SECRET_KEY=sk_test_your_stripe_test_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
FUNCTIONS_EMULATOR=true
```

### Testing API Endpoints
```bash
# Health check
curl http://localhost:5001/your-project/us-central1/api/health

# Test authentication required endpoint (need to include Authorization header)
curl -H "Authorization: Bearer YOUR_ID_TOKEN" \
     http://localhost:5001/your-project/us-central1/api/posts
```

## 🏭 Production Deployment

### Deploy Functions
```bash
# Deploy all functions
firebase deploy --only functions

# Deploy specific function
firebase deploy --only functions:api
```

### Deploy Database Rules
```bash
# Deploy Firestore rules
firebase deploy --only firestore:rules

# Deploy Storage rules  
firebase deploy --only storage
```

## 🔐 Security Checklist
- [ ] Firestore Rules: Deployed and tested
- [ ] Environment Variables: All secrets configured via Firebase config
- [ ] CORS: Properly configured for your domain
- [ ] Rate Limiting: Enabled for all public endpoints
- [ ] Input Validation: All endpoints use Zod validation schemas
- [ ] Authentication: All protected routes use auth middleware
- [ ] Admin Routes: Properly restricted to admin users only
- [ ] File Uploads: Size limits and type validation in place
- [ ] Payment Security: Stripe webhooks verified

## 📊 Monitoring and Logs

### View Logs
```bash
# View function logs
firebase functions:log

# View specific function logs
firebase functions:log --only api

# Stream logs in real-time
firebase functions:log --only api --follow
```

## 🐛 Troubleshooting

### Common Issues

**Functions not deploying:**
- Check Node.js version compatibility
- Verify all dependencies are installed
- Check for TypeScript errors: `npm run build`

**Authentication errors:**
- Verify ID tokens are valid and not expired
- Check Firestore rules match your authentication logic
- Ensure custom claims are set correctly for admin users

**Payment issues:**
- Verify Stripe keys in Firebase config
- Check webhook endpoint is accessible
- Validate webhook signatures

**AI API failures:**
- Check Gemini API key is valid
- Monitor API quotas and limits
- Verify request format matches expected schema

## 📞 Support

For issues and questions:
- Check the troubleshooting section above
- Review Firebase Functions logs
- Check Firestore rules and indexes
- Verify environment variable configuration

## ⚠️ Important Security Notes:
- Never commit real API keys or secrets to version control
- Always use Firebase Functions config for sensitive data
- Regularly rotate API keys and webhook secrets
- Monitor access logs for suspicious activity
