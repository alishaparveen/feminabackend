"use strict";
/**
 * Booking Routes for Femina Platform
 * Handles consultation bookings, scheduling, and management
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingsRoutes = void 0;
const express_1 = require("express");
const firestore_1 = require("firebase-admin/firestore");
const zod_1 = require("zod");
const validation_1 = require("../middleware/validation");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
exports.bookingsRoutes = router;
const db = (0, firestore_1.getFirestore)();
// Validation schemas
const createBookingSchema = zod_1.z.object({
    expertId: zod_1.z.string(),
    consultationType: zod_1.z.enum(['video', 'chat', 'phone']),
    scheduledAt: zod_1.z.string().datetime(),
    duration: zod_1.z.number().min(15).max(180), // 15 minutes to 3 hours
    notes: zod_1.z.string().max(500).optional(),
    timezone: zod_1.z.string().optional()
});
const updateBookingStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(['confirmed', 'cancelled', 'completed', 'no_show']),
    reason: zod_1.z.string().optional(),
    notes: zod_1.z.string().optional()
});
const addConsultationNotesSchema = zod_1.z.object({
    notes: zod_1.z.string().min(10).max(2000),
    recommendations: zod_1.z.array(zod_1.z.string()).optional(),
    followUpRequired: zod_1.z.boolean().default(false),
    followUpDate: zod_1.z.string().datetime().optional(),
    sharedWithClient: zod_1.z.boolean().default(false)
});
const rescheduleBookingSchema = zod_1.z.object({
    newScheduledAt: zod_1.z.string().datetime(),
    reason: zod_1.z.string().min(5).max(200)
});
/**
 * GET /api/bookings/my-bookings
 * Get user's bookings (as client or expert)
 */
router.get('/my-bookings', async (req, res) => {
    try {
        const userId = req.user.uid;
        const { role = 'client', status, page = 1, limit = 20, upcoming = 'false' } = req.query;
        // Filter by role (client or expert)
        const bookingsCollection = db.collection('bookings');
        let queryRef;
        if (role === 'expert') {
            queryRef = bookingsCollection.where('expertId', '==', userId);
        }
        else {
            queryRef = bookingsCollection.where('userId', '==', userId);
        }
        let query = queryRef;
        // Filter by status
        if (status) {
            query = query.where('status', '==', status);
        }
        // Filter for upcoming bookings only
        if (upcoming === 'true') {
            query = query.where('scheduledAt', '>', new Date());
        }
        // Sort by scheduled date
        query = query.orderBy('scheduledAt', 'desc');
        // Apply pagination
        const offset = (Number(page) - 1) * Number(limit);
        query = query.offset(offset).limit(Number(limit));
        const querySnapshot = await query.get();
        const bookings = await Promise.all(querySnapshot.docs.map(async (bookingDoc) => {
            const booking = bookingDoc.data();
            // Get expert info
            const expertDoc = await db.collection('experts').doc(booking.expertId).get();
            const expertData = expertDoc.data();
            // Get client info (for experts viewing their bookings)
            let clientData = null;
            if (role === 'expert') {
                const clientDoc = await db.collection('users').doc(booking.userId).get();
                const clientInfo = clientDoc.data();
                clientData = {
                    displayName: clientInfo?.displayName,
                    photoURL: clientInfo?.photoURL
                };
            }
            return {
                id: bookingDoc.id,
                ...booking,
                expert: expertData ? {
                    uid: expertData.uid,
                    displayName: expertData.displayName,
                    photoURL: expertData.photoURL,
                    specialties: expertData.specialties,
                    verified: expertData.verified
                } : null,
                client: clientData,
                // Remove sensitive payment info from response
                paymentIntentId: undefined,
                stripeSessionId: undefined
            };
        }));
        res.json({
            success: true,
            data: {
                bookings,
                pagination: {
                    currentPage: Number(page),
                    hasMore: querySnapshot.size === Number(limit)
                },
                role,
                filters: { status, upcoming: upcoming === 'true' }
            }
        });
    }
    catch (error) {
        console.error('Error fetching bookings:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch bookings'
        });
    }
});
/**
 * POST /api/bookings
 * Create a new booking
 */
router.post('/', (0, validation_1.validateRequest)(createBookingSchema), async (req, res) => {
    try {
        const userId = req.user.uid;
        const { expertId, consultationType, scheduledAt, duration, notes, timezone } = req.body;
        // Validate the expert exists and is available
        const expertDoc = await db.collection('experts').doc(expertId).get();
        if (!expertDoc.exists) {
            return res.status(404).json({
                error: 'Expert Not Found',
                message: 'Expert not found'
            });
        }
        const expertData = expertDoc.data();
        if (!expertData.available) {
            return res.status(400).json({
                error: 'Expert Unavailable',
                message: 'This expert is currently unavailable'
            });
        }
        // Check if the consultation type is supported
        if (!expertData.consultationTypes?.includes(consultationType)) {
            return res.status(400).json({
                error: 'Consultation Type Not Supported',
                message: `This expert does not offer ${consultationType} consultations`
            });
        }
        // Check if the requested time slot is available
        const requestedTime = new Date(scheduledAt);
        const endTime = new Date(requestedTime.getTime() + duration * 60000);
        // Check for conflicting bookings
        const conflictingBookings = await db.collection('bookings')
            .where('expertId', '==', expertId)
            .where('status', 'in', ['confirmed', 'pending_payment'])
            .where('scheduledAt', '<=', endTime)
            .get();
        const hasConflict = conflictingBookings.docs.some(doc => {
            const booking = doc.data();
            const bookingEnd = new Date(booking.scheduledAt.toDate().getTime() + booking.duration * 60000);
            return bookingEnd > requestedTime;
        });
        if (hasConflict) {
            return res.status(400).json({
                error: 'Time Slot Unavailable',
                message: 'The requested time slot is not available'
            });
        }
        // Calculate price
        const pricePerMinute = expertData.hourlyRate / 60;
        const totalPrice = Math.round(pricePerMinute * duration * 100); // in cents
        // Create booking
        const bookingId = db.collection('bookings').doc().id;
        const now = new Date();
        const newBooking = {
            id: bookingId,
            userId,
            expertId,
            consultationType,
            scheduledAt: requestedTime,
            duration,
            status: 'pending_payment',
            price: totalPrice,
            currency: 'usd',
            notes: notes || '',
            timezone: timezone || 'UTC',
            createdAt: now,
            updatedAt: now,
            paymentStatus: 'pending',
            meetingLink: null,
            completedAt: null,
            cancelledAt: null,
            consultationNotes: null
        };
        await db.collection('bookings').doc(bookingId).set(newBooking);
        // Create notification for expert
        await db.collection('notifications').add({
            userId: expertId,
            type: 'booking_request',
            title: 'New Booking Request',
            message: `You have a new ${consultationType} consultation request`,
            bookingId,
            actionUserId: userId,
            createdAt: now,
            read: false
        });
        // Log activity
        await db.collection('userActivity').add({
            userId,
            action: 'booking_created',
            bookingId,
            expertId,
            timestamp: now,
            metadata: {
                consultationType,
                duration,
                scheduledAt: requestedTime
            }
        });
        res.status(201).json({
            success: true,
            data: {
                bookingId,
                status: 'pending_payment',
                totalPrice: totalPrice / 100, // Convert back to dollars
                currency: 'usd',
                message: 'Booking created successfully. Please complete payment to confirm.'
            }
        });
    }
    catch (error) {
        console.error('Error creating booking:', error);
        res.status(500).json({
            error: 'Booking Error',
            message: 'Failed to create booking'
        });
    }
});
/**
 * GET /api/bookings/:bookingId
 * Get specific booking details
 */
router.get('/:bookingId', async (req, res) => {
    try {
        const { bookingId } = req.params;
        const userId = req.user.uid;
        const bookingDoc = await db.collection('bookings').doc(bookingId).get();
        if (!bookingDoc.exists) {
            return res.status(404).json({
                error: 'Booking Not Found',
                message: 'Booking not found'
            });
        }
        const booking = bookingDoc.data();
        // Check access permissions (only client or expert can view)
        if (booking.userId !== userId && booking.expertId !== userId) {
            return res.status(403).json({
                error: 'Unauthorized',
                message: 'You can only view your own bookings'
            });
        }
        // Get expert info
        const expertDoc = await db.collection('experts').doc(booking.expertId).get();
        const expertData = expertDoc.data();
        // Get client info
        const clientDoc = await db.collection('users').doc(booking.userId).get();
        const clientData = clientDoc.data();
        // Get consultation notes if user is the expert or client
        let consultationNotes = null;
        if (booking.consultationNotes) {
            const notesDoc = await db.collection('consultationNotes').doc(booking.consultationNotes).get();
            if (notesDoc.exists) {
                const notes = notesDoc.data();
                // Only show notes if shared with client or user is the expert
                if (notes.sharedWithClient || booking.expertId === userId) {
                    consultationNotes = notes;
                }
            }
        }
        const enrichedBooking = {
            id: bookingId,
            ...booking,
            expert: expertData ? {
                uid: expertData.uid,
                displayName: expertData.displayName,
                photoURL: expertData.photoURL,
                specialties: expertData.specialties,
                verified: expertData.verified
            } : null,
            client: {
                uid: clientData?.uid,
                displayName: clientData?.displayName,
                photoURL: clientData?.photoURL
            },
            consultationNotes,
            // Remove sensitive data
            paymentIntentId: undefined,
            stripeSessionId: undefined
        };
        res.json({
            success: true,
            data: enrichedBooking
        });
    }
    catch (error) {
        console.error('Error fetching booking:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch booking details'
        });
    }
});
/**
 * PUT /api/bookings/:bookingId/status
 * Update booking status
 */
router.put('/:bookingId/status', (0, validation_1.validateRequest)(updateBookingStatusSchema), async (req, res) => {
    try {
        const { bookingId } = req.params;
        const userId = req.user.uid;
        const { status, reason, notes } = req.body;
        const bookingDoc = await db.collection('bookings').doc(bookingId).get();
        if (!bookingDoc.exists) {
            return res.status(404).json({
                error: 'Booking Not Found',
                message: 'Booking not found'
            });
        }
        const booking = bookingDoc.data();
        // Check permissions based on status change
        let canUpdate = false;
        if (status === 'cancelled') {
            // Both client and expert can cancel
            canUpdate = booking.userId === userId || booking.expertId === userId;
        }
        else if (status === 'completed' || status === 'no_show') {
            // Only expert can mark as completed or no-show
            canUpdate = booking.expertId === userId;
        }
        else if (status === 'confirmed') {
            // This should typically happen via payment confirmation
            canUpdate = booking.expertId === userId || booking.userId === userId;
        }
        if (!canUpdate) {
            return res.status(403).json({
                error: 'Unauthorized',
                message: 'You cannot update this booking status'
            });
        }
        // Validate status transition
        const validTransitions = {
            'pending_payment': ['cancelled', 'confirmed'],
            'confirmed': ['cancelled', 'completed', 'no_show'],
            'completed': [], // Cannot change from completed
            'cancelled': [], // Cannot change from cancelled
            'no_show': []
        };
        if (!validTransitions[booking.status]?.includes(status)) {
            return res.status(400).json({
                error: 'Invalid Status Transition',
                message: `Cannot change status from ${booking.status} to ${status}`
            });
        }
        // Update booking
        const updateData = {
            status,
            updatedAt: new Date(),
            [`${status}At`]: new Date(),
            [`${status}By`]: userId
        };
        if (reason)
            updateData.statusReason = reason;
        if (notes)
            updateData.statusNotes = notes;
        await bookingDoc.ref.update(updateData);
        // Handle specific status changes
        if (status === 'cancelled') {
            // Send notification to the other party
            const recipientId = booking.userId === userId ? booking.expertId : booking.userId;
            await db.collection('notifications').add({
                userId: recipientId,
                type: 'booking_cancelled',
                title: 'Booking Cancelled',
                message: `A consultation booking has been cancelled${reason ? `: ${reason}` : ''}`,
                bookingId,
                actionUserId: userId,
                createdAt: new Date(),
                read: false
            });
            // If payment was made, initiate refund process
            if (booking.paymentStatus === 'paid') {
                // This would typically trigger a refund workflow
                await db.collection('refundQueue').add({
                    bookingId,
                    paymentIntentId: booking.paymentIntentId,
                    amount: booking.price,
                    reason: 'booking_cancelled',
                    requestedBy: userId,
                    createdAt: new Date(),
                    status: 'pending'
                });
            }
        }
        else if (status === 'completed') {
            // Update expert statistics
            await db.collection('experts').doc(booking.expertId).update({
                completedConsultations: firestore_1.FieldValue.increment(1),
                totalEarnings: firestore_1.FieldValue.increment(booking.price / 100)
            });
            // Send notification to client for review
            await db.collection('notifications').add({
                userId: booking.userId,
                type: 'booking_completed',
                title: 'Consultation Completed',
                message: 'Your consultation has been completed. Please leave a review!',
                bookingId,
                actionUserId: userId,
                createdAt: new Date(),
                read: false
            });
        }
        // Log activity
        await db.collection('userActivity').add({
            userId,
            action: `booking_${status}`,
            bookingId,
            timestamp: new Date(),
            metadata: { reason, previousStatus: booking.status }
        });
        res.json({
            success: true,
            data: {
                bookingId,
                status,
                message: `Booking ${status} successfully`
            }
        });
    }
    catch (error) {
        console.error('Error updating booking status:', error);
        res.status(500).json({
            error: 'Update Error',
            message: 'Failed to update booking status'
        });
    }
});
/**
 * POST /api/bookings/:bookingId/reschedule
 * Reschedule a booking
 */
router.post('/:bookingId/reschedule', (0, validation_1.validateRequest)(rescheduleBookingSchema), async (req, res) => {
    try {
        const { bookingId } = req.params;
        const userId = req.user.uid;
        const { newScheduledAt, reason } = req.body;
        const bookingDoc = await db.collection('bookings').doc(bookingId).get();
        if (!bookingDoc.exists) {
            return res.status(404).json({
                error: 'Booking Not Found',
                message: 'Booking not found'
            });
        }
        const booking = bookingDoc.data();
        // Check permissions (both client and expert can reschedule)
        if (booking.userId !== userId && booking.expertId !== userId) {
            return res.status(403).json({
                error: 'Unauthorized',
                message: 'You can only reschedule your own bookings'
            });
        }
        // Check if booking can be rescheduled
        if (!['confirmed', 'pending_payment'].includes(booking.status)) {
            return res.status(400).json({
                error: 'Cannot Reschedule',
                message: 'This booking cannot be rescheduled'
            });
        }
        const newTime = new Date(newScheduledAt);
        const endTime = new Date(newTime.getTime() + booking.duration * 60000);
        // Check for conflicts at the new time
        const conflictingBookings = await db.collection('bookings')
            .where('expertId', '==', booking.expertId)
            .where('status', 'in', ['confirmed', 'pending_payment'])
            .where('scheduledAt', '<=', endTime)
            .get();
        const hasConflict = conflictingBookings.docs.some(doc => {
            if (doc.id === bookingId)
                return false; // Ignore current booking
            const conflictBooking = doc.data();
            const conflictEnd = new Date(conflictBooking.scheduledAt.toDate().getTime() + conflictBooking.duration * 60000);
            return conflictEnd > newTime;
        });
        if (hasConflict) {
            return res.status(400).json({
                error: 'Time Slot Unavailable',
                message: 'The requested new time slot is not available'
            });
        }
        // Update booking with new time
        await bookingDoc.ref.update({
            scheduledAt: newTime,
            rescheduledAt: new Date(),
            rescheduledBy: userId,
            rescheduleReason: reason,
            updatedAt: new Date()
        });
        // Send notification to the other party
        const recipientId = booking.userId === userId ? booking.expertId : booking.userId;
        await db.collection('notifications').add({
            userId: recipientId,
            type: 'booking_rescheduled',
            title: 'Booking Rescheduled',
            message: `A consultation has been rescheduled to ${newTime.toLocaleString()}`,
            bookingId,
            actionUserId: userId,
            createdAt: new Date(),
            read: false
        });
        // Log activity
        await db.collection('userActivity').add({
            userId,
            action: 'booking_rescheduled',
            bookingId,
            timestamp: new Date(),
            metadata: {
                oldTime: booking.scheduledAt,
                newTime,
                reason
            }
        });
        res.json({
            success: true,
            data: {
                bookingId,
                newScheduledAt: newTime,
                message: 'Booking rescheduled successfully'
            }
        });
    }
    catch (error) {
        console.error('Error rescheduling booking:', error);
        res.status(500).json({
            error: 'Reschedule Error',
            message: 'Failed to reschedule booking'
        });
    }
});
/**
 * POST /api/bookings/:bookingId/notes
 * Add consultation notes (expert only)
 */
router.post('/:bookingId/notes', auth_1.expertOnly, (0, validation_1.validateRequest)(addConsultationNotesSchema), async (req, res) => {
    try {
        const { bookingId } = req.params;
        const userId = req.user.uid;
        const { notes, recommendations, followUpRequired, followUpDate, sharedWithClient } = req.body;
        const bookingDoc = await db.collection('bookings').doc(bookingId).get();
        if (!bookingDoc.exists) {
            return res.status(404).json({
                error: 'Booking Not Found',
                message: 'Booking not found'
            });
        }
        const booking = bookingDoc.data();
        // Check if user is the expert for this booking
        if (booking.expertId !== userId) {
            return res.status(403).json({
                error: 'Unauthorized',
                message: 'Only the expert can add consultation notes'
            });
        }
        // Check if consultation is completed
        if (booking.status !== 'completed') {
            return res.status(400).json({
                error: 'Consultation Not Completed',
                message: 'Notes can only be added to completed consultations'
            });
        }
        // Create consultation notes
        const notesId = db.collection('consultationNotes').doc().id;
        const consultationNotes = {
            id: notesId,
            bookingId,
            expertId: userId,
            userId: booking.userId,
            notes,
            recommendations: recommendations || [],
            followUpRequired,
            followUpDate: followUpDate ? new Date(followUpDate) : null,
            sharedWithClient,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        await db.collection('consultationNotes').doc(notesId).set(consultationNotes);
        // Update booking with notes reference
        await bookingDoc.ref.update({
            consultationNotes: notesId,
            updatedAt: new Date()
        });
        // If shared with client, send notification
        if (sharedWithClient) {
            await db.collection('notifications').add({
                userId: booking.userId,
                type: 'consultation_notes',
                title: 'Consultation Notes Available',
                message: 'Your consultation notes are now available',
                bookingId,
                notesId,
                actionUserId: userId,
                createdAt: new Date(),
                read: false
            });
        }
        // Log activity
        await db.collection('userActivity').add({
            userId,
            action: 'consultation_notes_added',
            bookingId,
            notesId,
            timestamp: new Date(),
            metadata: {
                sharedWithClient,
                followUpRequired
            }
        });
        res.status(201).json({
            success: true,
            data: {
                notesId,
                sharedWithClient,
                message: 'Consultation notes added successfully'
            }
        });
    }
    catch (error) {
        console.error('Error adding consultation notes:', error);
        res.status(500).json({
            error: 'Notes Error',
            message: 'Failed to add consultation notes'
        });
    }
});
/**
 * POST /api/bookings/:bookingId/review
 * Submit a review for completed booking (client only)
 */
router.post('/:bookingId/review', async (req, res) => {
    try {
        const { bookingId } = req.params;
        const userId = req.user.uid;
        const { rating, comment } = req.body;
        // Validate rating
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({
                error: 'Invalid Rating',
                message: 'Rating must be between 1 and 5'
            });
        }
        const bookingDoc = await db.collection('bookings').doc(bookingId).get();
        if (!bookingDoc.exists) {
            return res.status(404).json({
                error: 'Booking Not Found',
                message: 'Booking not found'
            });
        }
        const booking = bookingDoc.data();
        // Check if user is the client
        if (booking.userId !== userId) {
            return res.status(403).json({
                error: 'Unauthorized',
                message: 'Only the client can submit a review'
            });
        }
        // Check if booking is completed
        if (booking.status !== 'completed') {
            return res.status(400).json({
                error: 'Booking Not Completed',
                message: 'Can only review completed consultations'
            });
        }
        // Check if review already exists
        const existingReview = await db.collection('reviews')
            .where('bookingId', '==', bookingId)
            .get();
        if (!existingReview.empty) {
            return res.status(400).json({
                error: 'Review Already Exists',
                message: 'You have already reviewed this consultation'
            });
        }
        // Create review
        const reviewId = db.collection('reviews').doc().id;
        const review = {
            id: reviewId,
            bookingId,
            expertId: booking.expertId,
            userId,
            rating,
            comment: comment || '',
            consultationType: booking.consultationType,
            createdAt: new Date()
        };
        await db.collection('reviews').doc(reviewId).set(review);
        // Update expert's rating
        const expertDoc = await db.collection('experts').doc(booking.expertId).get();
        const expertData = expertDoc.data();
        const currentRating = expertData.rating || 0;
        const currentReviewCount = expertData.reviewCount || 0;
        const newReviewCount = currentReviewCount + 1;
        const newRating = ((currentRating * currentReviewCount) + rating) / newReviewCount;
        await expertDoc.ref.update({
            rating: Math.round(newRating * 10) / 10, // Round to 1 decimal place
            reviewCount: newReviewCount,
            updatedAt: new Date()
        });
        // Send notification to expert
        await db.collection('notifications').add({
            userId: booking.expertId,
            type: 'new_review',
            title: 'New Review Received',
            message: `You received a ${rating}-star review`,
            bookingId,
            reviewId,
            actionUserId: userId,
            createdAt: new Date(),
            read: false
        });
        // Log activity
        await db.collection('userActivity').add({
            userId,
            action: 'review_submitted',
            bookingId,
            reviewId,
            timestamp: new Date(),
            metadata: { rating }
        });
        res.status(201).json({
            success: true,
            data: {
                reviewId,
                rating,
                message: 'Review submitted successfully'
            }
        });
    }
    catch (error) {
        console.error('Error submitting review:', error);
        res.status(500).json({
            error: 'Review Error',
            message: 'Failed to submit review'
        });
    }
});
/**
 * GET /api/bookings/:bookingId/meeting-link
 * Get meeting link for video consultations
 */
router.get('/:bookingId/meeting-link', async (req, res) => {
    try {
        const { bookingId } = req.params;
        const userId = req.user.uid;
        const bookingDoc = await db.collection('bookings').doc(bookingId).get();
        if (!bookingDoc.exists) {
            return res.status(404).json({
                error: 'Booking Not Found',
                message: 'Booking not found'
            });
        }
        const booking = bookingDoc.data();
        // Check access permissions
        if (booking.userId !== userId && booking.expertId !== userId) {
            return res.status(403).json({
                error: 'Unauthorized',
                message: 'You can only access your own booking links'
            });
        }
        // Check if booking is confirmed and for video consultation
        if (booking.status !== 'confirmed') {
            return res.status(400).json({
                error: 'Booking Not Confirmed',
                message: 'Meeting link only available for confirmed bookings'
            });
        }
        if (booking.consultationType !== 'video') {
            return res.status(400).json({
                error: 'Not Video Consultation',
                message: 'Meeting link only available for video consultations'
            });
        }
        // Generate meeting link if not exists
        let meetingLink = booking.meetingLink;
        if (!meetingLink) {
            // In a real implementation, you would integrate with a video service like Zoom, Google Meet, etc.
            // For now, we'll generate a placeholder link
            meetingLink = `https://meet.femina.app/room/${bookingId}`;
            await bookingDoc.ref.update({
                meetingLink,
                updatedAt: new Date()
            });
        }
        // Check if consultation time is within 15 minutes
        const consultationTime = booking.scheduledAt.toDate();
        const now = new Date();
        const timeDiff = consultationTime.getTime() - now.getTime();
        const minutesUntil = Math.floor(timeDiff / (1000 * 60));
        res.json({
            success: true,
            data: {
                meetingLink,
                scheduledAt: consultationTime,
                minutesUntil,
                canJoin: minutesUntil <= 15 && minutesUntil >= -60, // Can join 15 min before to 60 min after
                consultationType: booking.consultationType
            }
        });
    }
    catch (error) {
        console.error('Error getting meeting link:', error);
        res.status(500).json({
            error: 'Meeting Error',
            message: 'Failed to get meeting link'
        });
    }
});
/**
 * GET /api/bookings/upcoming
 * Get upcoming bookings for dashboard
 */
router.get('/upcoming', async (req, res) => {
    try {
        const userId = req.user.uid;
        const { limit = 5 } = req.query;
        const now = new Date();
        // Get upcoming bookings as client
        const clientBookingsQuery = await db.collection('bookings')
            .where('userId', '==', userId)
            .where('status', 'in', ['confirmed', 'pending_payment'])
            .where('scheduledAt', '>', now)
            .orderBy('scheduledAt', 'asc')
            .limit(Number(limit))
            .get();
        // Get upcoming bookings as expert
        const expertBookingsQuery = await db.collection('bookings')
            .where('expertId', '==', userId)
            .where('status', '==', 'confirmed')
            .where('scheduledAt', '>', now)
            .orderBy('scheduledAt', 'asc')
            .limit(Number(limit))
            .get();
        const clientBookings = await Promise.all(clientBookingsQuery.docs.map(async (doc) => {
            const booking = doc.data();
            const expertDoc = await db.collection('experts').doc(booking.expertId).get();
            const expertData = expertDoc.data();
            return {
                id: doc.id,
                ...booking,
                role: 'client',
                expert: expertData ? {
                    displayName: expertData.displayName,
                    photoURL: expertData.photoURL,
                    specialties: expertData.specialties
                } : null
            };
        }));
        const expertBookings = await Promise.all(expertBookingsQuery.docs.map(async (doc) => {
            const booking = doc.data();
            const clientDoc = await db.collection('users').doc(booking.userId).get();
            const clientData = clientDoc.data();
            return {
                id: doc.id,
                ...booking,
                role: 'expert',
                client: {
                    displayName: clientData?.displayName,
                    photoURL: clientData?.photoURL
                }
            };
        }));
        // Combine and sort by scheduled time
        const allBookings = [...clientBookings, ...expertBookings]
            .sort((a, b) => a.scheduledAt.toDate().getTime() - b.scheduledAt.toDate().getTime())
            .slice(0, Number(limit));
        res.json({
            success: true,
            data: {
                bookings: allBookings,
                total: allBookings.length
            }
        });
    }
    catch (error) {
        console.error('Error fetching upcoming bookings:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch upcoming bookings'
        });
    }
});
//# sourceMappingURL=bookings.js.map