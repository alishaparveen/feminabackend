"use strict";
/**
 * Marketplace Routes for Femina Platform
 * Handles product listings, orders, and e-commerce functionality
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.marketplaceRoutes = void 0;
const express_1 = require("express");
const firestore_1 = require("firebase-admin/firestore");
const zod_1 = require("zod");
const validation_1 = require("../middleware/validation");
const router = (0, express_1.Router)();
exports.marketplaceRoutes = router;
const db = (0, firestore_1.getFirestore)();
// Validation schemas
const createProductSchema = zod_1.z.object({
    title: zod_1.z.string().min(5).max(100),
    description: zod_1.z.string().min(20).max(2000),
    price: zod_1.z.number().min(0.01).max(10000),
    category: zod_1.z.enum(['beauty', 'health', 'fitness', 'fashion', 'books', 'courses', 'supplements', 'accessories']),
    tags: zod_1.z.array(zod_1.z.string()).max(10).optional(),
    images: zod_1.z.array(zod_1.z.string().url()).max(10).optional(),
    inventory: zod_1.z.number().min(0).optional(),
    shippingRequired: zod_1.z.boolean().default(true),
    digitalProduct: zod_1.z.boolean().default(false),
    specifications: zod_1.z.record(zod_1.z.string()).optional()
});
const updateProductSchema = zod_1.z.object({
    title: zod_1.z.string().min(5).max(100).optional(),
    description: zod_1.z.string().min(20).max(2000).optional(),
    price: zod_1.z.number().min(0.01).max(10000).optional(),
    tags: zod_1.z.array(zod_1.z.string()).max(10).optional(),
    images: zod_1.z.array(zod_1.z.string().url()).max(10).optional(),
    inventory: zod_1.z.number().min(0).optional(),
    available: zod_1.z.boolean().optional(),
    specifications: zod_1.z.record(zod_1.z.string()).optional()
});
const createOrderSchema = zod_1.z.object({
    productId: zod_1.z.string(),
    quantity: zod_1.z.number().min(1).max(100),
    shippingAddress: zod_1.z.object({
        name: zod_1.z.string(),
        street: zod_1.z.string(),
        city: zod_1.z.string(),
        state: zod_1.z.string(),
        zipCode: zod_1.z.string(),
        country: zod_1.z.string()
    }).optional()
});
/**
 * GET /api/marketplace/products
 * Get marketplace products with filtering
 */
router.get('/products', async (req, res) => {
    try {
        const { category, minPrice, maxPrice, search, sortBy = 'recent', page = 1, limit = 20, available = 'true' } = req.query;
        let query = db.collection('products');
        // Apply filters
        if (category) {
            query = query.where('category', '==', category);
        }
        if (available === 'true') {
            query = query.where('available', '==', true);
        }
        if (minPrice) {
            query = query.where('price', '>=', Number(minPrice));
        }
        if (maxPrice) {
            query = query.where('price', '<=', Number(maxPrice));
        }
        // Apply sorting
        switch (sortBy) {
            case 'price_low':
                query = query.orderBy('price', 'asc');
                break;
            case 'price_high':
                query = query.orderBy('price', 'desc');
                break;
            case 'popular':
                query = query.orderBy('soldCount', 'desc');
                break;
            case 'rating':
                query = query.orderBy('rating', 'desc');
                break;
            case 'recent':
            default:
                query = query.orderBy('createdAt', 'desc');
                break;
        }
        // Apply pagination
        const offset = (Number(page) - 1) * Number(limit);
        query = query.offset(offset).limit(Number(limit));
        const querySnapshot = await query.get();
        let products = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        // Apply search filter if specified (client-side filtering)
        if (search) {
            const searchTerm = search.toLowerCase();
            products = products.filter(product => {
                const title = product.title || '';
                const description = product.description || '';
                const tags = product.tags || [];
                return (title.toLowerCase().includes(searchTerm) ||
                    description.toLowerCase().includes(searchTerm) ||
                    (Array.isArray(tags) && tags.some((tag) => tag.toLowerCase().includes(searchTerm))));
            });
        }
        // Get seller information for products
        const sellerIds = [
            ...new Set(products
                .map((product) => product.sellerId)
                .filter((id) => typeof id === 'string' && id.length > 0))
        ];
        const sellersSnapshot = sellerIds.length
            ? await db.collection('users')
                .where('uid', 'in', sellerIds.slice(0, 10))
                .get()
            : { docs: [] };
        const sellersMap = new Map();
        sellersSnapshot.docs.forEach(doc => {
            const data = doc.data();
            sellersMap.set(doc.id, {
                uid: data.uid,
                displayName: data.displayName,
                photoURL: data.photoURL,
                verified: data.verified
            });
        });
        const enrichedProducts = products.map(product => ({
            ...product,
            seller: sellersMap.get(product.sellerId) || null,
            // Remove sensitive seller data
            sellerId: undefined
        }));
        res.json({
            success: true,
            data: {
                products: enrichedProducts,
                pagination: {
                    currentPage: Number(page),
                    hasMore: querySnapshot.size === Number(limit)
                },
                filters: {
                    category: category || 'all',
                    priceRange: {
                        min: minPrice ? Number(minPrice) : null,
                        max: maxPrice ? Number(maxPrice) : null
                    },
                    search: search || null,
                    sortBy
                }
            }
        });
    }
    catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch products'
        });
    }
});
/**
 * POST /api/marketplace/products
 * Create a new product listing
 */
router.post('/products', (0, validation_1.validateRequest)(createProductSchema), async (req, res) => {
    try {
        const userId = req.user.uid;
        const productData = req.body;
        // Check if user is verified to sell
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data();
        if (!userData?.verified) {
            return res.status(403).json({
                error: 'Verification Required',
                message: 'You must be a verified user to list products'
            });
        }
        const productId = db.collection('products').doc().id;
        const now = new Date();
        const newProduct = {
            id: productId,
            sellerId: userId,
            ...productData,
            available: true,
            rating: 0,
            reviewCount: 0,
            soldCount: 0,
            views: 0,
            createdAt: now,
            updatedAt: now,
            moderationStatus: 'approved' // Auto-approve for now
        };
        await db.collection('products').doc(productId).set(newProduct);
        // Update user's product count
        await db.collection('users').doc(userId).update({
            productCount: firestore_1.FieldValue.increment(1),
            lastProductAt: now
        });
        // Log activity
        await db.collection('userActivity').add({
            userId,
            action: 'product_created',
            productId,
            timestamp: now,
            metadata: {
                category: productData.category,
                price: productData.price
            }
        });
        res.status(201).json({
            success: true,
            data: {
                productId,
                message: 'Product listed successfully'
            }
        });
    }
    catch (error) {
        console.error('Error creating product:', error);
        res.status(500).json({
            error: 'Create Error',
            message: 'Failed to create product listing'
        });
    }
});
/**
 * GET /api/marketplace/products/:productId
 * Get specific product details
 */
router.get('/products/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const productDoc = await db.collection('products').doc(productId).get();
        if (!productDoc.exists) {
            return res.status(404).json({
                error: 'Product Not Found',
                message: 'Product not found'
            });
        }
        const productData = productDoc.data();
        // Increment view count
        await productDoc.ref.update({
            views: firestore_1.FieldValue.increment(1)
        });
        // Get seller information
        const sellerDoc = await db.collection('users').doc(productData.sellerId).get();
        const sellerData = sellerDoc.data();
        // Get recent reviews
        const reviewsQuery = await db.collection('productReviews')
            .where('productId', '==', productId)
            .orderBy('createdAt', 'desc')
            .limit(10)
            .get();
        const reviews = await Promise.all(reviewsQuery.docs.map(async (reviewDoc) => {
            const review = reviewDoc.data();
            const reviewerDoc = await db.collection('users').doc(review.userId).get();
            const reviewerData = reviewerDoc.data();
            return {
                id: reviewDoc.id,
                ...review,
                reviewer: {
                    displayName: reviewerData?.displayName?.charAt(0) + '***',
                    verified: reviewerData?.verified || false
                },
                userId: undefined
            };
        }));
        const enrichedProduct = {
            id: productId,
            ...productData,
            seller: {
                uid: sellerData?.uid,
                displayName: sellerData?.displayName,
                photoURL: sellerData?.photoURL,
                verified: sellerData?.verified,
                memberSince: sellerData?.createdAt
            },
            reviews: {
                recent: reviews,
                totalCount: productData.reviewCount || 0,
                averageRating: productData.rating || 0
            },
            // Remove sensitive data
            sellerId: undefined
        };
        res.json({
            success: true,
            data: enrichedProduct
        });
    }
    catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch product details'
        });
    }
});
/**
 * PUT /api/marketplace/products/:productId
 * Update product listing (seller only)
 */
router.put('/products/:productId', (0, validation_1.validateRequest)(updateProductSchema), async (req, res) => {
    try {
        const { productId } = req.params;
        const userId = req.user.uid;
        const productDoc = await db.collection('products').doc(productId).get();
        if (!productDoc.exists) {
            return res.status(404).json({
                error: 'Product Not Found',
                message: 'Product not found'
            });
        }
        const productData = productDoc.data();
        // Check ownership
        if (productData.sellerId !== userId) {
            return res.status(403).json({
                error: 'Unauthorized',
                message: 'You can only update your own products'
            });
        }
        const updateData = {
            ...req.body,
            updatedAt: new Date()
        };
        await productDoc.ref.update(updateData);
        // Log activity
        await db.collection('userActivity').add({
            userId,
            action: 'product_updated',
            productId,
            timestamp: new Date(),
            metadata: {
                changes: Object.keys(updateData)
            }
        });
        res.json({
            success: true,
            message: 'Product updated successfully'
        });
    }
    catch (error) {
        console.error('Error updating product:', error);
        res.status(500).json({
            error: 'Update Error',
            message: 'Failed to update product'
        });
    }
});
/**
 * DELETE /api/marketplace/products/:productId
 * Delete product listing (seller only)
 */
router.delete('/products/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const userId = req.user.uid;
        const productDoc = await db.collection('products').doc(productId).get();
        if (!productDoc.exists) {
            return res.status(404).json({
                error: 'Product Not Found',
                message: 'Product not found'
            });
        }
        const productData = productDoc.data();
        // Check ownership or admin privileges
        const userDoc = await db.collection('users').doc(userId).get();
        const isAdmin = userDoc.data()?.role === 'admin';
        if (productData.sellerId !== userId && !isAdmin) {
            return res.status(403).json({
                error: 'Unauthorized',
                message: 'You can only delete your own products'
            });
        }
        // Soft delete - mark as deleted
        await productDoc.ref.update({
            deleted: true,
            deletedAt: new Date(),
            deletedBy: userId,
            available: false
        });
        // Update user's product count
        await db.collection('users').doc(productData.sellerId).update({
            productCount: firestore_1.FieldValue.increment(-1)
        });
        // Log activity
        await db.collection('userActivity').add({
            userId,
            action: 'product_deleted',
            productId,
            timestamp: new Date(),
            metadata: {
                wasOwner: productData.sellerId === userId
            }
        });
        res.json({
            success: true,
            message: 'Product deleted successfully'
        });
    }
    catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({
            error: 'Delete Error',
            message: 'Failed to delete product'
        });
    }
});
/**
 * POST /api/marketplace/orders
 * Create a new order
 */
router.post('/orders', (0, validation_1.validateRequest)(createOrderSchema), async (req, res) => {
    try {
        const userId = req.user.uid;
        const { productId, quantity, shippingAddress } = req.body;
        // Get product details
        const productDoc = await db.collection('products').doc(productId).get();
        if (!productDoc.exists) {
            return res.status(404).json({
                error: 'Product Not Found',
                message: 'Product not found'
            });
        }
        const productData = productDoc.data();
        // Check if product is available
        if (!productData.available) {
            return res.status(400).json({
                error: 'Product Unavailable',
                message: 'This product is currently unavailable'
            });
        }
        // Check inventory
        if (productData.inventory !== undefined && productData.inventory < quantity) {
            return res.status(400).json({
                error: 'Insufficient Inventory',
                message: `Only ${productData.inventory} items available`
            });
        }
        // Calculate total price
        const itemPrice = productData.price;
        const subtotal = itemPrice * quantity;
        const shipping = productData.shippingRequired ? 5.99 : 0; // Simple shipping calculation
        const tax = subtotal * 0.08; // 8% tax (simplified)
        const total = subtotal + shipping + tax;
        // Create order
        const orderId = db.collection('orders').doc().id;
        const now = new Date();
        const newOrder = {
            id: orderId,
            userId,
            sellerId: productData.sellerId,
            productId,
            productTitle: productData.title,
            productImage: productData.images?.[0] || null,
            quantity,
            itemPrice,
            subtotal,
            shipping,
            tax,
            total,
            status: 'pending_payment',
            shippingAddress: shippingAddress || null,
            createdAt: now,
            updatedAt: now,
            paymentStatus: 'pending',
            trackingNumber: null,
            shippedAt: null,
            deliveredAt: null
        };
        await db.collection('orders').doc(orderId).set(newOrder);
        // Create notification for seller
        await db.collection('notifications').add({
            userId: productData.sellerId,
            type: 'new_order',
            title: 'New Order Received',
            message: `You have a new order for ${productData.title}`,
            orderId,
            actionUserId: userId,
            createdAt: now,
            read: false
        });
        // Log activity
        await db.collection('userActivity').add({
            userId,
            action: 'order_created',
            orderId,
            productId,
            timestamp: now,
            metadata: {
                quantity,
                total
            }
        });
        res.status(201).json({
            success: true,
            data: {
                orderId,
                total,
                status: 'pending_payment',
                message: 'Order created successfully. Please complete payment.'
            }
        });
    }
    catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({
            error: 'Order Error',
            message: 'Failed to create order'
        });
    }
});
/**
 * GET /api/marketplace/orders/my-orders
 * Get user's orders (as buyer or seller)
 */
router.get('/orders/my-orders', async (req, res) => {
    try {
        const userId = req.user.uid;
        const { role = 'buyer', status, page = 1, limit = 20 } = req.query;
        let query = db.collection('orders');
        // Filter by role
        if (role === 'seller') {
            query = query.where('sellerId', '==', userId);
        }
        else {
            query = query.where('userId', '==', userId);
        }
        // Filter by status
        if (status) {
            query = query.where('status', '==', status);
        }
        // Sort by creation date
        query = query.orderBy('createdAt', 'desc');
        // Apply pagination
        const offset = (Number(page) - 1) * Number(limit);
        query = query.offset(offset).limit(Number(limit));
        const querySnapshot = await query.get();
        const orders = await Promise.all(querySnapshot.docs.map(async (orderDoc) => {
            const order = orderDoc.data();
            // Get additional info based on role
            if (role === 'seller') {
                // Get buyer info for sellers
                const buyerDoc = await db.collection('users').doc(order.userId).get();
                const buyerData = buyerDoc.data();
                return {
                    id: orderDoc.id,
                    ...order,
                    buyer: {
                        displayName: buyerData?.displayName,
                        photoURL: buyerData?.photoURL
                    }
                };
            }
            else {
                // Get seller info for buyers
                const sellerDoc = await db.collection('users').doc(order.sellerId).get();
                const sellerData = sellerDoc.data();
                return {
                    id: orderDoc.id,
                    ...order,
                    seller: {
                        displayName: sellerData?.displayName,
                        photoURL: sellerData?.photoURL,
                        verified: sellerData?.verified
                    }
                };
            }
        }));
        res.json({
            success: true,
            data: {
                orders,
                pagination: {
                    currentPage: Number(page),
                    hasMore: querySnapshot.size === Number(limit)
                },
                role,
                filters: { status }
            }
        });
    }
    catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch orders'
        });
    }
});
/**
 * GET /api/marketplace/orders/:orderId
 * Get specific order details
 */
router.get('/orders/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.uid;
        const orderDoc = await db.collection('orders').doc(orderId).get();
        if (!orderDoc.exists) {
            return res.status(404).json({
                error: 'Order Not Found',
                message: 'Order not found'
            });
        }
        const order = orderDoc.data();
        // Check access permissions
        if (order.userId !== userId && order.sellerId !== userId) {
            return res.status(403).json({
                error: 'Unauthorized',
                message: 'You can only view your own orders'
            });
        }
        // Get product details
        const productDoc = await db.collection('products').doc(order.productId).get();
        const productData = productDoc.data();
        // Get buyer and seller info
        const buyerDoc = await db.collection('users').doc(order.userId).get();
        const sellerDoc = await db.collection('users').doc(order.sellerId).get();
        const buyerData = buyerDoc.data();
        const sellerData = sellerDoc.data();
        const enrichedOrder = {
            id: orderId,
            ...order,
            product: productData ? {
                id: order.productId,
                title: productData.title,
                images: productData.images,
                category: productData.category
            } : null,
            buyer: {
                uid: buyerData?.uid,
                displayName: buyerData?.displayName,
                photoURL: buyerData?.photoURL
            },
            seller: {
                uid: sellerData?.uid,
                displayName: sellerData?.displayName,
                photoURL: sellerData?.photoURL,
                verified: sellerData?.verified
            }
        };
        res.json({
            success: true,
            data: enrichedOrder
        });
    }
    catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch order details'
        });
    }
});
/**
 * PUT /api/marketplace/orders/:orderId/status
 * Update order status (seller only)
 */
router.put('/orders/:orderId/status', async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.uid;
        const { status, trackingNumber, notes } = req.body;
        const orderDoc = await db.collection('orders').doc(orderId).get();
        if (!orderDoc.exists) {
            return res.status(404).json({
                error: 'Order Not Found',
                message: 'Order not found'
            });
        }
        const order = orderDoc.data();
        // Check if user is the seller
        if (order.sellerId !== userId) {
            return res.status(403).json({
                error: 'Unauthorized',
                message: 'Only the seller can update order status'
            });
        }
        // Validate status transitions
        const validStatuses = ['processing', 'shipped', 'delivered', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                error: 'Invalid Status',
                message: 'Invalid order status'
            });
        }
        const updateData = {
            status,
            updatedAt: new Date()
        };
        if (status === 'shipped') {
            updateData.shippedAt = new Date();
            if (trackingNumber) {
                updateData.trackingNumber = trackingNumber;
            }
        }
        else if (status === 'delivered') {
            updateData.deliveredAt = new Date();
        }
        if (notes) {
            updateData.statusNotes = notes;
        }
        await orderDoc.ref.update(updateData);
        // Send notification to buyer
        await db.collection('notifications').add({
            userId: order.userId,
            type: 'order_status_updated',
            title: 'Order Status Updated',
            message: `Your order status has been updated to: ${status}`,
            orderId,
            actionUserId: userId,
            createdAt: new Date(),
            read: false
        });
        // If order is completed, update product sold count
        if (status === 'delivered') {
            await db.collection('products').doc(order.productId).update({
                soldCount: firestore_1.FieldValue.increment(order.quantity),
                inventory: order.inventory !== undefined ?
                    firestore_1.FieldValue.increment(-order.quantity) : undefined
            });
        }
        // Log activity
        await db.collection('userActivity').add({
            userId,
            action: 'order_status_updated',
            orderId,
            timestamp: new Date(),
            metadata: {
                newStatus: status,
                previousStatus: order.status
            }
        });
        res.json({
            success: true,
            data: {
                orderId,
                status,
                trackingNumber: trackingNumber || null,
                message: 'Order status updated successfully'
            }
        });
    }
    catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({
            error: 'Update Error',
            message: 'Failed to update order status'
        });
    }
});
/**
 * GET /api/marketplace/categories
 * Get marketplace categories with product counts
 */
router.get('/categories', async (req, res) => {
    try {
        // Get all products and count by category
        const productsQuery = await db.collection('products')
            .where('available', '==', true)
            .get();
        const categoryCount = new Map();
        productsQuery.docs.forEach(doc => {
            const product = doc.data();
            const category = product.category;
            categoryCount.set(category, (categoryCount.get(category) || 0) + 1);
        });
        // Convert to array and add category metadata
        const categories = [
            { id: 'beauty', name: 'Beauty & Skincare', icon: '💄' },
            { id: 'health', name: 'Health & Wellness', icon: '🏥' },
            { id: 'fitness', name: 'Fitness & Exercise', icon: '💪' },
            { id: 'fashion', name: 'Fashion & Style', icon: '👗' },
            { id: 'books', name: 'Books & Learning', icon: '📚' },
            { id: 'courses', name: 'Online Courses', icon: '🎓' },
            { id: 'supplements', name: 'Supplements', icon: '💊' },
            { id: 'accessories', name: 'Accessories', icon: '✨' }
        ].map(category => ({
            ...category,
            productCount: categoryCount.get(category.id) || 0
        }));
        res.json({
            success: true,
            data: {
                categories,
                totalProducts: productsQuery.size
            }
        });
    }
    catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch categories'
        });
    }
});
/**
 * POST /api/marketplace/products/:productId/review
 * Submit a product review (buyer only)
 */
router.post('/products/:productId/review', async (req, res) => {
    try {
        const { productId } = req.params;
        const userId = req.user.uid;
        const { rating, comment, orderId } = req.body;
        // Validate rating
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({
                error: 'Invalid Rating',
                message: 'Rating must be between 1 and 5'
            });
        }
        // Check if user has purchased this product
        const orderQuery = await db.collection('orders')
            .where('userId', '==', userId)
            .where('productId', '==', productId)
            .where('status', '==', 'delivered')
            .limit(1)
            .get();
        if (orderQuery.empty) {
            return res.status(403).json({
                error: 'Purchase Required',
                message: 'You can only review products you have purchased'
            });
        }
        // Check if review already exists
        const existingReview = await db.collection('productReviews')
            .where('userId', '==', userId)
            .where('productId', '==', productId)
            .get();
        if (!existingReview.empty) {
            return res.status(400).json({
                error: 'Review Already Exists',
                message: 'You have already reviewed this product'
            });
        }
        // Create review
        const reviewId = db.collection('productReviews').doc().id;
        const review = {
            id: reviewId,
            productId,
            userId,
            orderId: orderId || null,
            rating,
            comment: comment || '',
            createdAt: new Date()
        };
        await db.collection('productReviews').doc(reviewId).set(review);
        // Update product rating
        const productDoc = await db.collection('products').doc(productId).get();
        const productData = productDoc.data();
        const currentRating = productData.rating || 0;
        const currentReviewCount = productData.reviewCount || 0;
        const newReviewCount = currentReviewCount + 1;
        const newRating = ((currentRating * currentReviewCount) + rating) / newReviewCount;
        await productDoc.ref.update({
            rating: Math.round(newRating * 10) / 10,
            reviewCount: newReviewCount,
            updatedAt: new Date()
        });
        // Send notification to seller
        await db.collection('notifications').add({
            userId: productData.sellerId,
            type: 'product_review',
            title: 'New Product Review',
            message: `You received a ${rating}-star review for ${productData.title}`,
            productId,
            reviewId,
            actionUserId: userId,
            createdAt: new Date(),
            read: false
        });
        // Log activity
        await db.collection('userActivity').add({
            userId,
            action: 'product_review_submitted',
            productId,
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
        console.error('Error submitting product review:', error);
        res.status(500).json({
            error: 'Review Error',
            message: 'Failed to submit review'
        });
    }
});
//# sourceMappingURL=marketplace.js.map