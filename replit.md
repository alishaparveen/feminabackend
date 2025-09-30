# Femina Platform

## Overview

Femina is a Firebase-based serverless backend platform designed specifically for women's empowerment and community building. The platform provides comprehensive API endpoints for community features (posts, comments, stories), AI-powered health assistance, expert consultations, and marketplace functionality. Built as a women-centric platform, it addresses unique challenges and experiences that women face across various life domains including health, career, relationships, and parenting.

The system operates as a complete social platform with expert consultation services, educational resources, storytelling capabilities, and e-commerce features, all powered by modern cloud technologies and AI integration.

## User Preferences

Preferred communication style: Simple, everyday language.

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
Google's Gemini AI (gemini-1.5-flash model) powers the platform's AI assistant functionality. The system provides category-specific guidance (health, career, relationships, parenting, fitness) with tailored prompts for each domain. AI moderation is implemented for content safety and community guidelines enforcement.

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

## External Dependencies

### Google Services
- **Firebase Cloud Functions**: Serverless compute platform for API endpoints
- **Firestore Database**: NoSQL document database for data persistence
- **Firebase Storage**: Cloud storage for files and media
- **Firebase Authentication**: User identity and authentication management
- **Google Generative AI (Gemini)**: AI assistant and content moderation capabilities

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