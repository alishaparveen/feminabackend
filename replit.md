# Femina Platform

## Overview

Femina is a Firebase-based serverless backend platform designed specifically for women's empowerment and community building. The platform provides comprehensive API endpoints for community features (posts, comments, stories), AI-powered health assistance, expert consultations, and marketplace functionality. Built as a women-centric platform, it addresses unique challenges and experiences that women face across various life domains including health, career, relationships, and parenting.

The system operates as a complete social platform with expert consultation services, educational resources, storytelling capabilities, and e-commerce features, all powered by modern cloud technologies and AI integration.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

**October 2025**:
- Added user onboarding endpoint (POST /api/onboard) for initial user setup with personalized pillars and tags for feed personalization

## System Architecture

### Backend Framework
The platform uses Firebase Cloud Functions with TypeScript as the primary serverless backend architecture. Express.js serves as the web framework, providing RESTful API endpoints with proper routing, middleware, and error handling. The system is designed for horizontal scaling through Firebase's managed infrastructure.

### Database Architecture
Firestore (NoSQL document database) serves as the primary data store, chosen for its real-time capabilities and seamless Firebase integration. The database handles user profiles, community posts, stories (with text/audio/image content), expert consultations, marketplace products, and chat interactions. Document-based storage allows for flexible schema evolution and efficient querying of hierarchical data structures.

**Stories Collection**: Supports rich media storytelling with text, images, and audio content. Features include category/subCategory organization, likes, saves, follows, view tracking, moderation workflows, and privacy controls (public/draft visibility). Each story is categorized (Health, Career, Relationships, Parenting, Finance, Lifestyle, Education, Support, or Uncategorized) with optional subcategories for more granular organization.

**Category Counting**: Denormalized category counts are maintained in meta/storyCategoryCounts document for fast topic count retrieval. Counts are updated transactionally on story create, delete, and category changes using Firestore FieldValue.increment() for eventual consistency.

### Authentication & Authorization
Firebase Authentication handles user identity management with custom role-based access control (RBAC). The system supports multiple user roles: user, expert, moderator, and admin. JWT tokens are verified through middleware, with additional user metadata stored in Firestore for role and permission management.

### AI Integration
Google's Gemini AI (gemini-1.5-flash model) powers the platform's AI assistant functionality. The system provides category-specific guidance (health, career, relationships, parenting, fitness) with tailored prompts for each domain.

**Perspective API**: Google's Perspective API provides automatic comment moderation by analyzing text for toxicity, threats, insults, profanity, identity attacks, and severe toxicity. Comments with scores above 0.7 threshold are automatically flagged and hidden from public view, requiring moderator review. The system maintains both legacy (moderationStatus) and enriched (moderation.status, scores, reasons) fields for backward compatibility and comprehensive audit trails.

### File Storage
Firebase Storage handles all file uploads including profile images, post attachments, story images, story audio, product images, and documents. The system uses Multer middleware for file processing, with image size limits (5MB) and audio limits (20MB). Files are organized by user and purpose with automatic public URL generation for media delivery.

### Payment Processing
Stripe integration handles all financial transactions including expert consultation payments, marketplace purchases, and subscription management. The system supports payment intents, refunds, and webhook processing for payment status updates.

### Rate Limiting & Security
Express-rate-limit provides API protection with different limits for various endpoint types. The system includes IP-based limiting, authentication rate limiting, AI interaction limits, and upload restrictions. CORS, Helmet.js, and request validation using Zod schemas provide additional security layers.

### Middleware Architecture
Custom middleware handles authentication verification, request validation, rate limiting, and role-based authorization. Zod schemas validate all incoming requests, ensuring data integrity and preventing malformed data processing.

### Content Moderation
Automated content moderation uses AI-powered analysis combined with human review workflows. The system supports content reporting, review queues, and automated action taking based on configurable rules and community guidelines.

**Admin Moderation System**: Comprehensive admin dashboard endpoints for moderators to review and action flagged/reported/pending comments. Features include:
- List comments needing moderation with filtering (flagged/pending/reported/all), severity sorting, text search, and pagination
- View full moderation details including Perspective API analysis, user reports, story context, and author information
- Single and bulk moderation actions (approve/reject/dismiss/resolve) with complete audit trail
- Report management with resolution workflows and optional comment action triggers
- Audit records stored in moderation/audit/records collection tracking all moderator actions with timestamp, moderator ID, status transitions, and notes
- Story comment counts automatically updated when comments are approved
- Protected by requireModerator middleware (checks moderator customClaim or moderators collection)

### Audio Pipeline
Google Cloud audio services power Stories audio generation and transcription capabilities. The system supports both Text-to-Speech (TTS) synthesis and Speech-to-Text (STT) transcription with comprehensive format support.

**Text-to-Speech (TTS)**: Converts story text to natural-sounding audio using Google Cloud TTS. Supports multiple voices and generates audio in MP3 or OGG format. Users can generate audio from full story text or excerpt (first 5000 characters). Audio metadata (duration, encoding, URL) is stored in the story document.

**Speech-to-Text (STT)**: Transcribes uploaded audio to text using Google Cloud STT. Supports multiple audio formats (mp3, webm, ogg, opus, wav, flac) with automatic sample rate detection. Long-running transcription jobs are tracked via Firestore, with a background poller checking job completion every 30 seconds. Transcripts include confidence scores and are stored in the story document.

**Audio Upload Workflows**:
1. Direct upload: Upload audio file, system stores it and automatically starts transcription
2. Signed URL: System generates pre-signed upload URL, client uploads directly to Firebase Storage, then manually triggers transcription

**Audio Metadata (Stories Collection)**:
- audioUrl, audioPath, audioEncoding (MP3, WEBM_OPUS, OGG_OPUS, LINEAR16, FLAC)
- audioStatus: none/pending_upload/processing/ready/failed
- audioDuration: Calculated duration in seconds
- transcript: Generated transcription text
- transcriptStatus: none/processing/completed/failed
- transcriptionConfidence: STT confidence score
- transcriptionJobId: Google Cloud operation ID for tracking
- ttsTaskId: TTS generation task identifier

**Audio API Endpoints** (routes/audio.js):
- POST /api/upload/:storyId - Upload audio or request signed URL (author-only)
- POST /api/stories/:id/generate-audio - Generate TTS audio from story text (author-only)
- POST /api/stories/:id/transcribe - Start transcription of uploaded audio (author-only)
- GET /api/stories/:id/audio-status - Get audio and transcription status (public)
- POST /api/stories/:id/regenerate-audio - Regenerate TTS audio (author-only)
- POST /api/transcription/webhook - Internal webhook for async transcription completion

**Audio Services**:
- services/tts.google.js: TTS synthesis with voice/format options, 5000 character limit, duration estimation
- services/stt.google.js: Short and long-running transcription with job status polling
- services/storageHelper.js: Firebase Storage operations including uploads, signed URLs, file management

**Background Worker**: workers/transcriptionPoller.js runs every 30 seconds to poll Google Cloud for transcription job completion, updating Firestore with results when ready. Requires Firestore composite index (transcriptStatus/transcriptionJobId) deployed for efficient queries.

### User Onboarding
Initial user setup system that collects personalization data for feed customization. Users select pillars (life areas) and tags (specific interests) during onboarding to receive personalized content recommendations.

**Firestore Schema (users collection)**:
- id: Firebase user ID
- name: User's name (1-50 characters)
- age: User's age (13-120)
- pillars: Array of 1-5 pillar IDs from ['health', 'money', 'heart', 'life', 'soul']
- tags: Array of interest tags (optional)
- onboardingCompletedAt: ISO timestamp of completion
- updatedAt: ISO timestamp of last update
- preferences.pillars: Duplicate for easy querying
- preferences.tags: Duplicate for easy querying
- preferences.lastUpdated: ISO timestamp

**API Endpoint** (routes/onboarding.js):
- POST /api/onboard - Complete user onboarding with personalization data (auth required)

**Validation**:
- name: Required string, 1-50 characters, trimmed
- age: Required number, 13-120 range
- pillars: Required array, 1-5 valid pillar IDs
- tags: Optional array of strings

**Usage**: The saved pillars and tags in preferences should be used to filter and prioritize stories matching user interests, implement scoring algorithms for "For You" feed, and provide personalized recommendations.

### User Preferences & Saved Filters
Per-user preferences system for personalized content discovery and saved filter management. Users can follow categories, create custom saved filters for Stories & Community, and receive personalized recommendations.

**Firestore Schema (users collection)**:
- preferences.followedCategories: Array of category strings (e.g., ["Health/Mental Health", "Career/Career Growth"])
- preferences.savedFilters: Object map of filter IDs to filter objects with name, type, query, timestamps
- preferences.discoverySettings: Optional age, interests for personalized recommendations
- preferences.isSeed: 'demo' marker for admin-seeded test data

**Supported Categories**: Health, Health/Mental Health, Health/PCOS, Health/Pregnancy, Health/Menopause, Career, Career/Career Growth, Career/Work-Life Balance, Career/Leadership, Relationships, Relationships/Marriage, Relationships/Dating, Relationships/Friendship, Parenting, Parenting/Newborn, Parenting/Toddler, Parenting/Teen, Finance, Finance/Investing, Finance/Budgeting, Finance/Entrepreneurship, Lifestyle, Lifestyle/Travel, Lifestyle/Hobbies, Lifestyle/Home, Education, Education/Skills, Education/Degrees, Support, Support/Abuse, Support/Loss, Support/Trauma, Wellness, Wellness/Yoga, Wellness/Meditation, Wellness/Fitness, Legal, Legal/Family Law, Legal/Workplace Law, Legal/Property Rights

**Filter Types**: stories, community

**Saved Filter Query Fields (Validated)**: category, subCategory, tags, sort (newest/top/most_commented), pageSize (1-50), dateRange

**API Endpoints** (routes/preferences.js):
- GET /api/users/me/preferences - Get user's preferences (auth required)
- PUT /api/users/me/preferences - Update preferences (partial merge, auth required)
- POST /api/users/me/preferences/follow - Follow a category (auth required)
- POST /api/users/me/preferences/unfollow - Unfollow a category (auth required)
- POST /api/users/me/preferences/filters - Create saved filter (auth required)
- PUT /api/users/me/preferences/filters/:filterId - Update saved filter (auth required, ownership enforced)
- DELETE /api/users/me/preferences/filters/:filterId - Delete saved filter (auth required, ownership enforced)
- GET /api/recommendations/categories - Get recommended categories based on age/followed categories (optional auth)
- POST /api/admin/seed-preferences - Seed demo preferences for test users (admin only)

**Validation & Security**:
- All category strings validated against VALID_CATEGORIES array
- SubCategory validation ensures value is in VALID_CATEGORIES and matches category prefix (e.g., "Health/Mental Health" requires category "Health")
- Filter queries validated to only allow safe fields (no raw where clauses)
- PUT /me/preferences rejects direct savedFilters updates, enforcing use of filter-specific endpoints
- Firestore transactions use arrayUnion/arrayRemove for concurrent category updates
- Ownership enforcement: users can only modify their own filters
- Admin seeding isolated in routes/adminPreferences.js, mounted exclusively at /api/admin/seed-preferences with authenticateUser + adminGuard middleware

**Services** (services/preferencesService.js):
- Category and filter query validation
- CRUD operations for preferences and filters
- Recommendation algorithm based on age groups and followed categories
- Demo data seeding for testing

**Testing**:
- Unit tests: tests/preferences.test.js (Jest with mocked Firestore)
- Manual integration script: scripts/manual_check_preferences.sh (curl examples)

## External Dependencies

### Google Services
- **Firebase Cloud Functions**: Serverless compute platform for API endpoints
- **Firestore Database**: NoSQL document database for data persistence
- **Firebase Storage**: Cloud storage for files and media
- **Firebase Authentication**: User identity and authentication management
- **Google Generative AI (Gemini)**: AI assistant and content moderation capabilities
- **Perspective API**: Automatic comment toxicity analysis and moderation
- **Google Cloud Text-to-Speech**: AI-powered voice synthesis for generating audio from story text
- **Google Cloud Speech-to-Text**: Automatic transcription of uploaded story audio to text

### Payment Processing
- **Stripe**: Complete payment processing platform for consultations, marketplace transactions, and subscription management

### Development & Deployment
- **Firebase CLI**: Deployment and project management tools
- **Node.js 18+**: Runtime environment with TypeScript support

### Core Libraries
- **Express.js**: Web application framework for API routing
- **Zod**: Schema validation library for request/response validation
- **Multer**: File upload handling middleware
- **Sharp**: Image processing and optimization
- **Express-rate-limit**: API rate limiting and protection
- **UUID**: Unique identifier generation for resources
- **Lodash**: Utility library for data manipulation
- **CORS & Helmet**: Security middleware for API protection

The platform is configured for deployment in the `asia-south1` region and includes comprehensive emulator support for local development and testing.