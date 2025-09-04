import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { CustomError } from '../middleware/errorHandler';
import { body, validationResult } from 'express-validator';

const router = Router();
const prisma = new PrismaClient();

// Apply authentication to all routes
router.use(authenticate);

// Validation rules
const createOrderValidation = [
  body('clientId').isUUID().withMessage('Valid client ID is required'),
  body('orderDate').isISO8601().withMessage('Valid order date is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.productId').isUUID().withMessage('Valid product ID is required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('items.*.unitPrice').isDecimal({ decimal_digits: '0,2' }).withMessage('Valid unit price is required')
];

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private
router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const clientId = req.query.clientId as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const sortBy = (req.query.sortBy as string) || 'createdAt';
    const sortOrder = (req.query.sortOrder as string) || 'desc';

    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};
    
    if (status) {
      where.status = status;
    }

    if (clientId) {
      where.clientId = clientId;
    }

    if (startDate || endDate) {
      where.orderDate = {};
      if (startDate) where.orderDate.gte = new Date(startDate);
      if (endDate) where.orderDate.lte = new Date(endDate);
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          client: {
            select: { id: true, name: true, phone: true }
          },
          creator: {
            select: { id: true, fullName: true }
          },
          orderItems: {
            include: {
              product: {
                select: { id: true, name: true, price: true }
              }
            }
          },
          invoices: {
            select: { id: true, invoiceNumber: true, status: true, amount: true }
          },
          deliverySchedules: {
            select: { id: true, scheduledDate: true, status: true }
          }
        }
      }),
      prisma.order.count({ where })
    ]);

    res.status(200).json({
      success: true,
      data: {
        orders,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private
router.get('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        client: true,
        creator: {
          select: { id: true, fullName: true, email: true }
        },
        orderItems: {
          include: {
            product: true
          }
        },
        invoices: true,
        deliverySchedules: {
          include: {
            driver: {
              select: { id: true, fullName: true, phone: true }
            }
          }
        },
        returns: true
      }
    });

    if (!order) {
      throw new CustomError('Order not found', 404);
    }

    res.status(200).json({
      success: true,
      data: { order }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
router.post('/', createOrderValidation, async (req: AuthenticatedRequest, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new CustomError('Validation failed', 400);
    }

    const { clientId, orderDate, items, notes } = req.body;

    // Verify client exists
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      throw new CustomError('Client not found', 404);
    }

    // Verify all products exist and calculate totals
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await prisma.product.findUnique({ where: { id: item.productId } });
      if (!product) {
        throw new CustomError(`Product with ID ${item.productId} not found`, 404);
      }

      const unitPrice = parseFloat(item.unitPrice);
      const quantity = parseInt(item.quantity);
      const totalPrice = unitPrice * quantity;
      
      subtotal += totalPrice;
      
      orderItems.push({
        productId: item.productId,
        quantity,
        unitPrice,
        totalPrice,
        notes: item.notes || null
      });
    }

    // Calculate tax (assuming 10% tax rate, this should be configurable)
    const taxRate = 0.10;
    const taxAmount = subtotal * taxRate;
    const totalAmount = subtotal + taxAmount;

    // Create order with items in a transaction
    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          clientId,
          createdBy: req.user!.id,
          orderDate: new Date(orderDate),
          subtotal,
          taxAmount,
          totalAmount,
          notes,
          orderItems: {
            create: orderItems
          }
        },
        include: {
          client: {
            select: { id: true, name: true, phone: true }
          },
          creator: {
            select: { id: true, fullName: true }
          },
          orderItems: {
            include: {
              product: {
                select: { id: true, name: true, price: true }
              }
            }
          }
        }
      });

      // Create delivery schedule (auto-schedule for next day)
      const deliveryDate = new Date(orderDate);
      deliveryDate.setDate(deliveryDate.getDate() + 1);

      await tx.deliverySchedule.create({
        data: {
          orderId: newOrder.id,
          clientId,
          scheduledDate: deliveryDate
        }
      });

      return newOrder;
    });

    res.status(201).json({
      success: true,
      data: { order }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private
router.put('/:id/status', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      throw new CustomError('Invalid status', 400);
    }

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) {
      throw new CustomError('Order not found', 404);
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: { status },
      include: {
        client: {
          select: { id: true, name: true, phone: true }
        },
        creator: {
          select: { id: true, fullName: true }
        },
        orderItems: {
          include: {
            product: {
              select: { id: true, name: true, price: true }
            }
          }
        }
      }
    });

    res.status(200).json({
      success: true,
      data: { order: updatedOrder }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get order analytics
// @route   GET /api/orders/analytics
// @access  Private
router.get('/analytics/summary', async (req: AuthenticatedRequest, res, next) => {
  try {
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const where: any = {};
    if (startDate || endDate) {
      where.orderDate = {};
      if (startDate) where.orderDate.gte = new Date(startDate);
      if (endDate) where.orderDate.lte = new Date(endDate);
    }

    const [totalOrders, totalRevenue, ordersByStatus, topProducts] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.aggregate({
        where,
        _sum: { totalAmount: true }
      }),
      prisma.order.groupBy({
        by: ['status'],
        where,
        _count: { status: true }
      }),
      prisma.orderItem.groupBy({
        by: ['productId'],
        where: {
          order: where
        },
        _sum: { quantity: true, totalPrice: true },
        _count: { productId: true },
        orderBy: { _sum: { totalPrice: 'desc' } },
        take: 10
      })
    ]);

    // Get product details for top products
    const productIds = topProducts.map(item => item.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, price: true }
    });

    const topProductsWithDetails = topProducts.map(item => {
      const product = products.find(p => p.id === item.productId);
      return {
        product,
        totalQuantity: item._sum.quantity,
        totalRevenue: item._sum.totalPrice,
        orderCount: item._count.productId
      };
    });

    res.status(200).json({
      success: true,
      data: {
        totalOrders,
        totalRevenue: totalRevenue._sum.totalAmount || 0,
        ordersByStatus,
        topProducts: topProductsWithDetails
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;