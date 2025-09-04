import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { CustomError } from '../middleware/errorHandler';
import { body, query, validationResult } from 'express-validator';

const router = Router();
const prisma = new PrismaClient();

// Apply authentication to all routes
router.use(authenticate);

// Validation rules
const createClientValidation = [
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('phone').isMobilePhone('any').withMessage('Valid phone number is required'),
  body('email').optional().isEmail().normalizeEmail(),
  body('businessId').optional().trim().isLength({ min: 1 }),
  body('monthlyConsumption').optional().isDecimal({ decimal_digits: '0,2' })
];

const updateClientValidation = [
  body('name').optional().trim().isLength({ min: 2 }),
  body('phone').optional().isMobilePhone('any'),
  body('email').optional().isEmail().normalizeEmail(),
  body('businessId').optional().trim().isLength({ min: 1 }),
  body('monthlyConsumption').optional().isDecimal({ decimal_digits: '0,2' }),
  body('status').optional().isIn(['ACTIVE', 'INACTIVE', 'SUSPENDED'])
];

// @desc    Get all clients
// @route   GET /api/clients
// @access  Private
router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const status = req.query.status as string;
    const sortBy = (req.query.sortBy as string) || 'createdAt';
    const sortOrder = (req.query.sortOrder as string) || 'desc';

    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
        { businessId: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (status) {
      where.status = status;
    }

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          creator: {
            select: { id: true, fullName: true, email: true }
          },
          _count: {
            select: {
              orders: true,
              maintenanceVisits: true,
              visitsCalls: true
            }
          }
        }
      }),
      prisma.client.count({ where })
    ]);

    res.status(200).json({
      success: true,
      data: {
        clients,
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

// @desc    Get single client
// @route   GET /api/clients/:id
// @access  Private
router.get('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;

    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, fullName: true, email: true }
        },
        orders: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            orderItems: {
              include: {
                product: { select: { id: true, name: true, price: true } }
              }
            }
          }
        },
        maintenanceVisits: {
          take: 5,
          orderBy: { scheduledDate: 'desc' }
        },
        visitsCalls: {
          take: 5,
          orderBy: { visitDate: 'desc' }
        },
        feedback: {
          take: 5,
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!client) {
      throw new CustomError('Client not found', 404);
    }

    res.status(200).json({
      success: true,
      data: { client }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Create new client
// @route   POST /api/clients
// @access  Private
router.post('/', createClientValidation, async (req: AuthenticatedRequest, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new CustomError('Validation failed', 400);
    }

    const { name, phone, email, businessId, taxNumber, branchInfo, monthlyConsumption } = req.body;

    // Check for duplicate phone or businessId
    const existingClient = await prisma.client.findFirst({
      where: {
        OR: [
          { phone },
          ...(businessId ? [{ businessId }] : [])
        ]
      }
    });

    if (existingClient) {
      throw new CustomError('Client with this phone number or business ID already exists', 400);
    }

    const client = await prisma.client.create({
      data: {
        name,
        phone,
        email,
        businessId,
        taxNumber,
        branchInfo,
        monthlyConsumption,
        createdBy: req.user!.id
      },
      include: {
        creator: {
          select: { id: true, fullName: true, email: true }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: { client }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Update client
// @route   PUT /api/clients/:id
// @access  Private
router.put('/:id', updateClientValidation, async (req: AuthenticatedRequest, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new CustomError('Validation failed', 400);
    }

    const { id } = req.params;
    const updateData = req.body;

    // Check if client exists
    const existingClient = await prisma.client.findUnique({ where: { id } });
    if (!existingClient) {
      throw new CustomError('Client not found', 404);
    }

    // Check for duplicate phone or businessId (excluding current client)
    if (updateData.phone || updateData.businessId) {
      const duplicateClient = await prisma.client.findFirst({
        where: {
          AND: [
            { id: { not: id } },
            {
              OR: [
                ...(updateData.phone ? [{ phone: updateData.phone }] : []),
                ...(updateData.businessId ? [{ businessId: updateData.businessId }] : [])
              ]
            }
          ]
        }
      });

      if (duplicateClient) {
        throw new CustomError('Client with this phone number or business ID already exists', 400);
      }
    }

    const client = await prisma.client.update({
      where: { id },
      data: updateData,
      include: {
        creator: {
          select: { id: true, fullName: true, email: true }
        }
      }
    });

    res.status(200).json({
      success: true,
      data: { client }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete client
// @route   DELETE /api/clients/:id
// @access  Private (Admin/Manager only)
router.delete('/:id', authorize('ADMIN', 'MANAGER'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;

    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) {
      throw new CustomError('Client not found', 404);
    }

    // Check if client has orders (prevent deletion if there are orders)
    const orderCount = await prisma.order.count({ where: { clientId: id } });
    if (orderCount > 0) {
      throw new CustomError('Cannot delete client with existing orders. Consider deactivating instead.', 400);
    }

    await prisma.client.delete({ where: { id } });

    res.status(200).json({
      success: true,
      message: 'Client deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;