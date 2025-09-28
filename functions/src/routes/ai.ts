/**
 * AI Assistant Routes for Femina Platform
 * Handles AI chat, recommendations, and health advice
 */

import { Router, Response } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { validateRequest } from '../middleware/validation';
import { AuthenticatedRequest } from '../types/auth';

const router = Router();
const db = getFirestore();

// Initialize Gemini AI (API key set via Firebase config)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Validation schemas
const chatMessageSchema = z.object({
  message: z.string().min(1).max(2000),
  category: z.enum(['general', 'health', 'career', 'relationships', 'parenting', 'fitness']).optional(),
  context: z.string().optional()
});

const feedbackSchema = z.object({
  messageId: z.string(),
  feedback: z.enum(['helpful', 'not_helpful', 'inappropriate']),
  comment: z.string().optional()
});

// System prompts for different categories
const SYSTEM_PROMPTS = {
  general: `You are Femina AI, a supportive and knowledgeable assistant designed specifically for women. 
    Provide helpful, empowering advice while being sensitive to women's unique experiences and challenges. 
    Always maintain a warm, understanding tone and prioritize safety and well-being.`,
    
  health: `You are a women's health assistant. Provide general health information and guidance, but always 
    remind users to consult healthcare professionals for medical concerns. Focus on women's health topics 
    including reproductive health, mental wellness, and preventive care.`,
    
  career: `You are a career counselor specializing in women's professional development. Help with career 
    advancement, workplace challenges, work-life balance, and breaking through barriers that women often face 
    in their careers.`,
    
  relationships: `You are a relationship advisor who understands the complexities of modern relationships. 
    Provide balanced, thoughtful advice on dating, marriage, friendships, family relationships, and setting 
    healthy boundaries.`,
    
  parenting: `You are a parenting advisor with expertise in child development and family dynamics. Provide 
    practical, evidence-based guidance while being supportive of different parenting styles and family structures.`,
    
  fitness: `You are a fitness and wellness coach specializing in women's health and fitness. Provide guidance 
    on exercise routines, nutrition, body positivity, and overall wellness tailored to women's needs.`
};

/**
 * POST /api/ai/chat
 * Send a message to the AI assistant
 */
router.post('/chat', validateRequest(chatMessageSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { message, category = 'general', context } = req.body;
    const userId = req.user!.uid;

    // Get user's conversation history for context
    const conversationRef = db.collection('conversations').doc(userId);
    const conversationDoc = await conversationRef.get();
    
    let conversationHistory: any[] = [];
    if (conversationDoc.exists) {
      const data = conversationDoc.data();
      conversationHistory = data?.messages?.slice(-5) || []; // Last 5 messages for context
    }

    // Build conversation context
    let contextPrompt = SYSTEM_PROMPTS[category as keyof typeof SYSTEM_PROMPTS];
    
    if (context) {
      contextPrompt += `\n\nAdditional context: ${context}`;
    }
    
    if (conversationHistory.length > 0) {
      contextPrompt += '\n\nRecent conversation history:\n';
      conversationHistory.forEach((msg, index) => {
        contextPrompt += `User: ${msg.message}\nAssistant: ${msg.response}\n`;
      });
    }

    contextPrompt += '\n\nCurrent message from user:';

    // Generate AI response
    const result = await model.generateContent([
      { text: contextPrompt },
      { text: message }
    ]);

    const response = result.response;
    const aiResponse = response.text();

    // Create message document
    const messageId = db.collection('conversations').doc().id;
    const messageData = {
      id: messageId,
      userId,
      message,
      response: aiResponse,
      category,
      timestamp: new Date(),
      feedback: null,
      context: context || null
    };

    // Save to conversation history
    await conversationRef.set({
      userId,
      lastMessageAt: new Date(),
      messageCount: (conversationDoc.exists ? (conversationDoc.data()?.messageCount || 0) + 1 : 1),
      messages: [...conversationHistory, messageData].slice(-20) // Keep last 20 messages
    }, { merge: true });

    // Also save individual message for analytics
    await db.collection('aiMessages').doc(messageId).set(messageData);

    res.json({
      success: true,
      data: {
        messageId,
        response: aiResponse,
        category,
        timestamp: messageData.timestamp
      }
    });

  } catch (error) {
    console.error('AI chat error:', error);
    res.status(500).json({
      error: 'AI Service Error',
      message: 'Failed to process AI request'
    });
  }
});

/**
 * GET /api/ai/conversation-history
 * Get user's conversation history with the AI
 */
router.get('/conversation-history', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;
    const { limit = 50, page = 1 } = req.query;

    const conversationRef = db.collection('conversations').doc(userId);
    const conversationDoc = await conversationRef.get();

    if (!conversationDoc.exists) {
      return res.json({
        success: true,
        data: {
          messages: [],
          totalCount: 0,
          hasMore: false
        }
      });
    }

    const data = conversationDoc.data();
    const allMessages = data?.messages || [];
    
    const startIndex = (Number(page) - 1) * Number(limit);
    const endIndex = startIndex + Number(limit);
    const paginatedMessages = allMessages.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: {
        messages: paginatedMessages.map((msg: any) => ({
          id: msg.id,
          message: msg.message,
          response: msg.response,
          category: msg.category,
          timestamp: msg.timestamp,
          feedback: msg.feedback
        })),
        totalCount: allMessages.length,
        hasMore: endIndex < allMessages.length,
        currentPage: Number(page),
        totalPages: Math.ceil(allMessages.length / Number(limit))
      }
    });

  } catch (error) {
    console.error('Error fetching conversation history:', error);
    res.status(500).json({
      error: 'Database Error',
      message: 'Failed to fetch conversation history'
    });
  }
});

/**
 * POST /api/ai/feedback
 * Provide feedback on AI responses
 */
router.post('/feedback', validateRequest(feedbackSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { messageId, feedback, comment } = req.body;
    const userId = req.user!.uid;

    // Update the message with feedback
    await db.collection('aiMessages').doc(messageId).update({
      feedback,
      feedbackComment: comment || null,
      feedbackAt: new Date(),
      feedbackUserId: userId
    });

    // Also update in conversation history
    const conversationRef = db.collection('conversations').doc(userId);
    const conversationDoc = await conversationRef.get();
    
    if (conversationDoc.exists) {
      const data = conversationDoc.data();
      const messages = data?.messages || [];
      
      const updatedMessages = messages.map((msg: any) => {
        if (msg.id === messageId) {
          return { ...msg, feedback, feedbackComment: comment || null };
        }
        return msg;
      });
      
      await conversationRef.update({ messages: updatedMessages });
    }

    res.json({
      success: true,
      message: 'Feedback recorded successfully'
    });

  } catch (error) {
    console.error('Error recording feedback:', error);
    res.status(500).json({
      error: 'Database Error',
      message: 'Failed to record feedback'
    });
  }
});

/**
 * POST /api/ai/recommendations
 * Get personalized recommendations based on user interests and activity
 */
router.post('/recommendations', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;
    const { type = 'general', count = 5 } = req.body;

    // Get user profile and activity data
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    // Get recent user activity
    const recentPosts = await db.collection('posts')
      .where('authorId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();

    const recentBookings = await db.collection('bookings')
      .where('userId', '==', userId)
      .orderBy('scheduledAt', 'desc')
      .limit(3)
      .get();

    // Build user context for recommendations
    const userContext = {
      interests: userData?.interests || [],
      recentPosts: recentPosts.docs.map(doc => doc.data().content).slice(0, 3),
      consultationHistory: recentBookings.docs.map(doc => doc.data().consultationType)
    };

    const recommendationPrompt = `
      Based on this user's profile and activity, provide ${count} personalized recommendations for ${type}.
      
      User interests: ${userContext.interests.join(', ')}
      Recent posts topics: ${userContext.recentPosts.join('; ')}
      Consultation types: ${userContext.consultationHistory.join(', ')}
      
      Provide recommendations as a JSON array with title, description, category, and priority fields.
      Focus on empowering content for women's growth and well-being.
    `;

    const result = await model.generateContent(recommendationPrompt);
    const response = result.response.text();

    // Parse AI response (with fallback for parsing errors)
    let recommendations;
    try {
      recommendations = JSON.parse(response);
    } catch {
      recommendations = [
        {
          title: 'Explore Women\'s Health Resources',
          description: 'Discover articles and tools to support your health journey',
          category: 'health',
          priority: 'high'
        }
      ];
    }

    // Save recommendations for analytics
    await db.collection('recommendations').add({
      userId,
      type,
      recommendations,
      generatedAt: new Date(),
      userContext
    });

    res.json({
      success: true,
      data: {
        recommendations,
        type,
        generatedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Error generating recommendations:', error);
    res.status(500).json({
      error: 'AI Service Error',
      message: 'Failed to generate recommendations'
    });
  }
});

/**
 * DELETE /api/ai/conversation
 * Clear user's conversation history
 */
router.delete('/conversation', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;

    // Delete conversation document
    await db.collection('conversations').doc(userId).delete();

    // Delete individual messages (in background)
    const messagesQuery = await db.collection('aiMessages').where('userId', '==', userId).get();
    const batch = db.batch();
    
    messagesQuery.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();

    res.json({
      success: true,
      message: 'Conversation history cleared successfully'
    });

  } catch (error) {
    console.error('Error clearing conversation:', error);
    res.status(500).json({
      error: 'Database Error',
      message: 'Failed to clear conversation history'
    });
  }
});

export { router as aiRoutes };