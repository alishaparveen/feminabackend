/**
 * Payment Processing Routes for Femina Platform
 * Handles Stripe payments for consultations and marketplace
 */

import { Router, Response } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import Stripe from 'stripe';
import { z } from 'zod';
import { validateRequest } from '../middleware/validation';
import { AuthenticatedRequest } from '../types/auth';

const router = Router();
const db = getFirestore();

// Initialize Stripe (API key set via Firebase config)
// TODO: set STRIPE_SECRET in firebase functions config
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16'
});

// Validation schemas
const createPaymentIntentSchema = z.object({
  amount: z.number().min(50), // Minimum $0.50
  currency: z.string().default('usd'),
  paymentType: z.enum(['consultation', 'marketplace', 'subscription']),
  itemId: z.string(), // booking ID, product ID, etc.
  metadata: z.record(z.string()).optional()
});

const confirmPaymentSchema = z.object({
  paymentIntentId: z.string(),
  paymentMethodId: z.string().optional()
});

const createSubscriptionSchema = z.object({
  priceId: z.string(),
  paymentMethodId: z.string()
});

const refundSchema = z.object({
  paymentIntentId: z.string(),
  amount: z.number().optional(), // Partial refund amount
  reason: z.enum(['requested_by_customer', 'duplicate', 'fraudulent', 'subscription_canceled']).optional()
});

/**
 * POST /api/payments/create-intent
 * Create a payment intent for Stripe
 */
router.post('/create-intent', validateRequest(createPaymentIntentSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { amount, currency, paymentType, itemId, metadata = {} } = req.body;
    const userId = req.user!.uid;

    // Get user information
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    if (!userData) {
      return res.status(404).json({
        error: 'User Not Found',
        message: 'User profile not found'
      });
    }

    // Validate the item exists and user has permission to pay for it
    const itemValidation = await validatePaymentItem(paymentType, itemId, userId);
    if (!itemValidation.valid) {
      return res.status(400).json({
        error: 'Invalid Payment Item',
        message: itemValidation.message
      });
    }

    // Create Stripe customer if doesn't exist
    let customerId = userData.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userData.email,
        name: userData.displayName,
        metadata: { firebaseUID: userId }
      });
      
      customerId = customer.id;
      await db.collection('users').doc(userId).update({
        stripeCustomerId: customerId
      });
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount), // Ensure integer cents
      currency: currency.toLowerCase(),
      customer: customerId,
      metadata: {
        userId,
        paymentType,
        itemId,
        ...metadata
      },
      automatic_payment_methods: {
        enabled: true
      }
    });

    // Store payment record
    const paymentId = db.collection('payments').doc().id;
    await db.collection('payments').doc(paymentId).set({
      id: paymentId,
      userId,
      stripePaymentIntentId: paymentIntent.id,
      amount,
      currency,
      paymentType,
      itemId,
      status: 'pending',
      createdAt: new Date(),
      metadata
    });

    res.json({
      success: true,
      data: {
        paymentId,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount,
        currency
      }
    });

  } catch (error) {
    console.error('Error creating payment intent:', error);
    res.status(500).json({
      error: 'Payment Error',
      message: 'Failed to create payment intent'
    });
  }
});

/**
 * POST /api/payments/confirm
 * Confirm payment completion
 */
router.post('/confirm', validateRequest(confirmPaymentSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { paymentIntentId, paymentMethodId } = req.body;
    const userId = req.user!.uid;

    // Retrieve payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (!paymentIntent) {
      return res.status(404).json({
        error: 'Payment Not Found',
        message: 'Payment intent not found'
      });
    }

    // Verify the payment belongs to this user
    if (paymentIntent.metadata?.userId !== userId) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'Payment does not belong to this user'
      });
    }

    // Update payment record in database
    const paymentsQuery = await db.collection('payments')
      .where('stripePaymentIntentId', '==', paymentIntentId)
      .get();

    if (paymentsQuery.empty) {
      return res.status(404).json({
        error: 'Payment Record Not Found',
        message: 'Local payment record not found'
      });
    }

    const paymentDoc = paymentsQuery.docs[0];
    const paymentData = paymentDoc.data();

    let updateData: any = {
      status: paymentIntent.status,
      updatedAt: new Date()
    };

    if (paymentIntent.status === 'succeeded') {
      updateData = {
        ...updateData,
        confirmedAt: new Date(),
        paymentMethodId: paymentMethodId || paymentIntent.payment_method
      };

      // Process successful payment based on type
      await processSuccessfulPayment(paymentData);
    }

    await paymentDoc.ref.update(updateData);

    res.json({
      success: true,
      data: {
        paymentId: paymentDoc.id,
        status: paymentIntent.status,
        amount: paymentData.amount,
        paymentType: paymentData.paymentType
      }
    });

  } catch (error) {
    console.error('Error confirming payment:', error);
    res.status(500).json({
      error: 'Payment Error',
      message: 'Failed to confirm payment'
    });
  }
});

/**
 * POST /api/payments/create-subscription
 * Create a subscription for premium features
 */
router.post('/create-subscription', validateRequest(createSubscriptionSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { priceId, paymentMethodId } = req.body;
    const userId = req.user!.uid;

    // Get user and customer information
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data()!;
    const customerId = userData.stripeCustomerId;

    if (!customerId) {
      return res.status(400).json({
        error: 'Customer Not Found',
        message: 'Stripe customer not found. Please create a payment intent first.'
      });
    }

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        payment_method_options: {
          card: {
            request_three_d_secure: 'if_required' as Stripe.PaymentIntentCreateParams.PaymentMethodOptions.Card.RequestThreeDSecure
          }
        },
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription'
      },
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        userId,
        subscriptionType: 'premium'
      }
    });

    // Store subscription record
    await db.collection('subscriptions').doc(subscription.id).set({
      id: subscription.id,
      userId,
      stripeSubscriptionId: subscription.id,
      priceId,
      status: subscription.status,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      createdAt: new Date(),
      metadata: subscription.metadata
    });

    const invoice = subscription.latest_invoice as Stripe.Invoice;
    const paymentIntent = invoice?.payment_intent as Stripe.PaymentIntent;

    res.json({
      success: true,
      data: {
        subscriptionId: subscription.id,
        clientSecret: paymentIntent?.client_secret,
        status: subscription.status
      }
    });

  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({
      error: 'Subscription Error',
      message: 'Failed to create subscription'
    });
  }
});

/**
 * GET /api/payments/history
 * Get user's payment history
 */
router.get('/history', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;
    const { limit = 20, page = 1, status, paymentType } = req.query;

    let query = db.collection('payments')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc');

    if (status) {
      query = query.where('status', '==', status);
    }

    if (paymentType) {
      query = query.where('paymentType', '==', paymentType);
    }

    const offset = (Number(page) - 1) * Number(limit);
    query = query.offset(offset).limit(Number(limit));

    const querySnapshot = await query.get();
    const payments = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      // Remove sensitive data
      stripePaymentIntentId: undefined,
      metadata: undefined
    }));

    res.json({
      success: true,
      data: {
        payments,
        pagination: {
          currentPage: Number(page),
          hasMore: querySnapshot.size === Number(limit)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({
      error: 'Database Error',
      message: 'Failed to fetch payment history'
    });
  }
});

/**
 * POST /api/payments/refund
 * Process refund (admin or self-service for specific cases)
 */
router.post('/refund', validateRequest(refundSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { paymentIntentId, amount, reason } = req.body;
    const userId = req.user!.uid;

    // Get payment record
    const paymentsQuery = await db.collection('payments')
      .where('stripePaymentIntentId', '==', paymentIntentId)
      .get();

    if (paymentsQuery.empty) {
      return res.status(404).json({
        error: 'Payment Not Found',
        message: 'Payment record not found'
      });
    }

    const paymentDoc = paymentsQuery.docs[0];
    const paymentData = paymentDoc.data();

    // Verify user owns this payment or is admin
    const userDoc = await db.collection('users').doc(userId).get();
    const isAdmin = userDoc.data()?.role === 'admin';
    
    if (paymentData.userId !== userId && !isAdmin) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'Cannot refund payment that does not belong to you'
      });
    }

    // Check if refund is eligible
    const eligibilityCheck = await checkRefundEligibility(paymentData);
    if (!eligibilityCheck.eligible) {
      return res.status(400).json({
        error: 'Refund Not Eligible',
        message: eligibilityCheck.reason
      });
    }

    // Create refund in Stripe
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: amount ? Math.round(amount) : undefined,
      reason: reason || 'requested_by_customer',
      metadata: {
        requestedBy: userId,
        originalPaymentId: paymentDoc.id
      }
    });

    // Update payment record
    await paymentDoc.ref.update({
      refunded: true,
      refundAmount: refund.amount,
      refundId: refund.id,
      refundedAt: new Date(),
      refundReason: reason,
      updatedAt: new Date()
    });

    // Process refund-related business logic
    await processRefund(paymentData, refund.amount);

    res.json({
      success: true,
      data: {
        refundId: refund.id,
        amount: refund.amount,
        status: refund.status
      }
    });

  } catch (error) {
    console.error('Error processing refund:', error);
    res.status(500).json({
      error: 'Refund Error',
      message: 'Failed to process refund'
    });
  }
});

/**
 * GET /api/payments/subscriptions
 * Get user's active subscriptions
 */
router.get('/subscriptions', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.uid;

    const subscriptionsQuery = await db.collection('subscriptions')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const subscriptions = subscriptionsQuery.docs.map(doc => doc.data());

    res.json({
      success: true,
      data: { subscriptions }
    });

  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    res.status(500).json({
      error: 'Database Error',
      message: 'Failed to fetch subscriptions'
    });
  }
});

// Helper functions

async function validatePaymentItem(paymentType: string, itemId: string, userId: string): Promise<{valid: boolean, message?: string}> {
  try {
    switch (paymentType) {
    case 'consultation':
      const bookingDoc = await db.collection('bookings').doc(itemId).get();
      if (!bookingDoc.exists) {
        return { valid: false, message: 'Booking not found' };
      }
      const bookingData = bookingDoc.data();
      if (bookingData?.userId !== userId) {
        return { valid: false, message: 'Booking does not belong to user' };
      }
      if (bookingData?.status !== 'pending_payment') {
        return { valid: false, message: 'Booking is not pending payment' };
      }
      return { valid: true };

    case 'marketplace':
      const productDoc = await db.collection('products').doc(itemId).get();
      if (!productDoc.exists) {
        return { valid: false, message: 'Product not found' };
      }
      const productData = productDoc.data();
      if (!productData?.available) {
        return { valid: false, message: 'Product is not available' };
      }
      return { valid: true };

    case 'subscription':
      // For subscriptions, itemId would be a price ID
      return { valid: true }; // Stripe will validate the price ID

    default:
      return { valid: false, message: 'Invalid payment type' };
    }
  } catch (error) {
    console.error('Error validating payment item:', error);
    return { valid: false, message: 'Validation error' };
  }
}

async function processSuccessfulPayment(paymentData: any): Promise<void> {
  try {
    switch (paymentData.paymentType) {
    case 'consultation':
      // Update booking status to confirmed
      await db.collection('bookings').doc(paymentData.itemId).update({
        status: 'confirmed',
        paidAt: new Date(),
        paymentId: paymentData.id
      });

      // Create notification for expert
      const bookingDoc = await db.collection('bookings').doc(paymentData.itemId).get();
      const bookingInfo = bookingDoc.data();
      if (bookingInfo?.expertId) {
        await db.collection('notifications').add({
          userId: bookingInfo.expertId,
          type: 'booking_confirmed',
          title: 'New Booking Confirmed',
          message: 'A consultation has been booked and paid for',
          bookingId: paymentData.itemId,
          createdAt: new Date(),
          read: false
        });
      }
      break;

    case 'marketplace':
      // Create order record
      const orderId = db.collection('orders').doc().id;
      await db.collection('orders').doc(orderId).set({
        id: orderId,
        userId: paymentData.userId,
        productId: paymentData.itemId,
        amount: paymentData.amount,
        currency: paymentData.currency,
        status: 'paid',
        paymentId: paymentData.id,
        createdAt: new Date()
      });

      // Update product inventory if applicable
      const productDoc = await db.collection('products').doc(paymentData.itemId).get();
      const productData = productDoc.data();
      if (productData?.inventory > 0) {
        await db.collection('products').doc(paymentData.itemId).update({
          inventory: productData.inventory - 1,
          soldCount: (productData.soldCount || 0) + 1
        });
      }
      break;

    case 'subscription':
      // Update user to premium status
      await db.collection('users').doc(paymentData.userId).update({
        isPremium: true,
        premiumSince: new Date(),
        subscriptionPaymentId: paymentData.id
      });
      break;
    }

    // Send confirmation notification to user
    await db.collection('notifications').add({
      userId: paymentData.userId,
      type: 'payment_confirmed',
      title: 'Payment Successful',
      message: `Your payment for ${paymentData.paymentType} has been processed successfully`,
      paymentId: paymentData.id,
      amount: paymentData.amount,
      createdAt: new Date(),
      read: false
    });

  } catch (error) {
    console.error('Error processing successful payment:', error);
    // Don't throw - payment was successful, this is just cleanup
  }
}

async function checkRefundEligibility(paymentData: any): Promise<{eligible: boolean, reason?: string}> {
  try {
    // Check if payment is recent enough (within refund window)
    const paymentDate = paymentData.createdAt.toDate();
    const now = new Date();
    const daysDiff = (now.getTime() - paymentDate.getTime()) / (1000 * 60 * 60 * 24);

    // Different refund policies based on payment type
    switch (paymentData.paymentType) {
    case 'consultation':
      if (daysDiff > 7) {
        return { eligible: false, reason: 'Consultation refunds are only available within 7 days' };
      }
        
      // Check if consultation has already started
      const bookingDoc = await db.collection('bookings').doc(paymentData.itemId).get();
      const bookingData = bookingDoc.data();
      if (bookingData?.status === 'completed') {
        return { eligible: false, reason: 'Cannot refund completed consultation' };
      }
        
      const scheduledTime = bookingData?.scheduledAt?.toDate();
      if (scheduledTime && scheduledTime <= now) {
        return { eligible: false, reason: 'Cannot refund past consultation' };
      }
        
      return { eligible: true };

    case 'marketplace':
      if (daysDiff > 30) {
        return { eligible: false, reason: 'Product refunds are only available within 30 days' };
      }
      return { eligible: true };

    case 'subscription':
      if (daysDiff > 1) {
        return { eligible: false, reason: 'Subscription refunds are only available within 24 hours' };
      }
      return { eligible: true };

    default:
      return { eligible: false, reason: 'Refunds not available for this payment type' };
    }
  } catch (error) {
    console.error('Error checking refund eligibility:', error);
    return { eligible: false, reason: 'Unable to verify refund eligibility' };
  }
}

async function processRefund(paymentData: any, refundAmount: number): Promise<void> {
  try {
    switch (paymentData.paymentType) {
    case 'consultation':
      // Update booking status
      await db.collection('bookings').doc(paymentData.itemId).update({
        status: 'cancelled_refunded',
        refundedAt: new Date(),
        refundAmount
      });

      // Notify expert of cancellation
      const bookingDoc = await db.collection('bookings').doc(paymentData.itemId).get();
      const bookingInfo = bookingDoc.data();
      if (bookingInfo?.expertId) {
        await db.collection('notifications').add({
          userId: bookingInfo.expertId,
          type: 'booking_cancelled',
          title: 'Booking Cancelled',
          message: 'A consultation booking has been cancelled and refunded',
          bookingId: paymentData.itemId,
          createdAt: new Date(),
          read: false
        });
      }
      break;

    case 'marketplace':
      // Update order status
      const ordersQuery = await db.collection('orders')
        .where('paymentId', '==', paymentData.id)
        .get();
        
      if (!ordersQuery.empty) {
        const orderDoc = ordersQuery.docs[0];
        await orderDoc.ref.update({
          status: 'refunded',
          refundedAt: new Date(),
          refundAmount
        });
      }
      break;

    case 'subscription':
      // Remove premium status
      await db.collection('users').doc(paymentData.userId).update({
        isPremium: false,
        premiumCancelledAt: new Date()
      });
      break;
    }

    // Send refund notification
    await db.collection('notifications').add({
      userId: paymentData.userId,
      type: 'refund_processed',
      title: 'Refund Processed',
      message: `Your refund of ${(refundAmount / 100).toFixed(2)} has been processed`,
      refundAmount,
      createdAt: new Date(),
      read: false
    });

  } catch (error) {
    console.error('Error processing refund:', error);
  }
}

export { router as paymentsRoutes };