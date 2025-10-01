# Femina Platform

## Overview
Femina is a Firebase-based serverless platform designed for women's empowerment and community building. It offers API endpoints for community features (posts, comments, stories), AI-powered health assistance, expert consultations, and marketplace functionality. The platform aims to address unique challenges women face in health, career, relationships, and parenting through a comprehensive social platform with expert services, educational resources, storytelling, and e-commerce, all powered by cloud technologies and AI.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Backend Framework
The platform utilizes Firebase Cloud Functions with TypeScript and Express.js, providing a serverless, scalable RESTful API with robust routing, middleware, and error handling.

### Database Architecture
Firestore serves as the primary NoSQL database, offering real-time capabilities for user profiles, community posts, multimedia stories (text, audio, image), expert consultations, marketplace products, and chat. Stories support rich media, categorization, moderation, and privacy controls, with denormalized category counts for efficient retrieval.

### Authentication & Authorization
Firebase Authentication manages user identities, supporting custom role-based access control (RBAC) for user, expert, moderator, and admin roles. JWT tokens and Firestore user metadata enforce permissions.

### AI Integration
Google's Gemini AI (gemini-1.5-flash) powers category-specific AI assistant guidance. Google's Perspective API automatically moderates comments for toxicity, flagging content above a 0.7 threshold for moderator review.

### File Storage
Firebase Storage handles all file uploads (profile images, post attachments, story media, product images) with Multer middleware for processing, size limits, and automatic URL generation.

### Payment Processing
Stripe manages all financial transactions, including expert consultations, marketplace purchases, and subscriptions, with support for payment intents, refunds, and webhooks.

### Rate Limiting & Security
Express-rate-limit protects API endpoints with various limits. Security layers include CORS, Helmet.js, and Zod schema validation for all incoming requests.

### Content Moderation
An automated system, augmented by human review workflows, uses AI analysis (Perspective API) for comment moderation. An admin dashboard provides tools for reviewing, filtering, and acting on flagged content, with audit trails and automatic updates to comment counts.

### Audio Pipeline
Google Cloud services enable Text-to-Speech (TTS) for story audio generation and Speech-to-Text (STT) for transcribing uploaded audio. The system supports various audio formats, tracks long-running transcription jobs in Firestore, and provides dedicated API endpoints for audio management.

### User Onboarding
An initial user setup system collects personalization data, including "pillars" (life areas) and "tags" (interests), to tailor content recommendations and create a personalized user feed.

### User Preferences & Saved Filters
Users can manage personalized content discovery through following categories, creating custom saved filters for Stories & Community, and receiving recommendations. Preferences are stored in Firestore, with robust validation for categories and filter queries.

## External Dependencies

### Google Services
- **Firebase Cloud Functions**: Serverless backend.
- **Firestore Database**: Primary NoSQL data store.
- **Firebase Storage**: Cloud storage for media and files.
- **Firebase Authentication**: User identity management.
- **Google Generative AI (Gemini)**: AI assistant and content generation.
- **Perspective API**: Automated comment toxicity analysis.
- **Google Cloud Text-to-Speech**: AI-powered voice synthesis.
- **Google Cloud Speech-to-Text**: Audio transcription.

### Payment Processing
- **Stripe**: Payment gateway for all transactions.

### Development & Deployment
- **Firebase CLI**: Deployment and project management.
- **Node.js 18+**: Runtime environment.

### Core Libraries
- **Express.js**: Web framework.
- **Zod**: Schema validation.
- **Multer**: File upload handling.
- **Sharp**: Image processing.
- **Express-rate-limit**: API rate limiting.
- **UUID**: Unique identifier generation.
- **Lodash**: Utility library.
- **CORS & Helmet**: Security middleware.