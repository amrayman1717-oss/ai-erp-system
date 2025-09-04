import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { CustomError } from '../middleware/errorHandler';
import { body, validationResult } from 'express-validator';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();
const prisma = new PrismaClient();

// Apply authentication to all routes
router.use(authenticate);

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/products';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760') // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images and PDF files are allowed'));
    }
  }
});

// Validation rules
const createProductValidation = [
  body('name').trim().isLength({ min: 2 }).withMessage('Product name must be at least 2 characters'),
  body('description').optional().trim(),
  body('price').isDecimal({ decimal_digits: '0,2' }).withMessage('Valid price is required'),
  body('qualityRating').optional().isInt({ min: 1, max: 5 }),
  body('specifications').optional().isJSON()
];

// @desc    Get all products
// @route   GET /api/products
// @access  Private
router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const isActive = req.query.isActive as string;
    const sortBy = (req.query.sortBy as string) || 'createdAt';
    const sortOrder = (req.query.sortOrder as string) || 'desc';

    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          creator: {
            select: { id: true, fullName: true }
          },
          productMedia: {
            orderBy: { sortOrder: 'asc' },
            take: 1 // Get first image for preview
          },
          _count: {
            select: { orderItems: true }
          }
        }
      }),
      prisma.product.count({ where })
    ]);

    res.status(200).json({
      success: true,
      data: {
        products,
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

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Private
router.get('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, fullName: true }
        },
        productMedia: {
          orderBy: { sortOrder: 'asc' }
        },
        orderItems: {
          take: 10,
          orderBy: { order: { createdAt: 'desc' } },
          include: {
            order: {
              select: {
                id: true,
                orderDate: true,
                client: { select: { id: true, name: true } }
              }
            }
          }
        }
      }
    });

    if (!product) {
      throw new CustomError('Product not found', 404);
    }

    res.status(200).json({
      success: true,
      data: { product }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Create new product
// @route   POST /api/products
// @access  Private
router.post('/', createProductValidation, async (req: AuthenticatedRequest, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new CustomError('Validation failed', 400);
    }

    const { name, description, price, qualityRating, specifications } = req.body;

    const product = await prisma.product.create({
      data: {
        name,
        description,
        price: parseFloat(price),
        qualityRating: qualityRating ? parseInt(qualityRating) : null,
        specifications: specifications ? JSON.parse(specifications) : null,
        createdBy: req.user!.id
      },
      include: {
        creator: {
          select: { id: true, fullName: true }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: { product }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Update product
// @route   PUT /api/products/:id
// @access  Private
router.put('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Check if product exists
    const existingProduct = await prisma.product.findUnique({ where: { id } });
    if (!existingProduct) {
      throw new CustomError('Product not found', 404);
    }

    // Convert string values to appropriate types
    if (updateData.price) updateData.price = parseFloat(updateData.price);
    if (updateData.qualityRating) updateData.qualityRating = parseInt(updateData.qualityRating);
    if (updateData.specifications && typeof updateData.specifications === 'string') {
      updateData.specifications = JSON.parse(updateData.specifications);
    }

    const product = await prisma.product.update({
      where: { id },
      data: updateData,
      include: {
        creator: {
          select: { id: true, fullName: true }
        },
        productMedia: {
          orderBy: { sortOrder: 'asc' }
        }
      }
    });

    res.status(200).json({
      success: true,
      data: { product }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Upload product media
// @route   POST /api/products/:id/media
// @access  Private
router.post('/:id/media', upload.array('files', 5), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      throw new CustomError('No files uploaded', 400);
    }

    // Check if product exists
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new CustomError('Product not found', 404);
    }

    // Get current max sort order
    const lastMedia = await prisma.productMedia.findFirst({
      where: { productId: id },
      orderBy: { sortOrder: 'desc' }
    });

    let sortOrder = lastMedia ? lastMedia.sortOrder + 1 : 0;

    // Create media records
    const mediaRecords = files.map(file => ({
      productId: id,
      filePath: file.path,
      fileType: file.mimetype,
      sortOrder: sortOrder++
    }));

    const productMedia = await prisma.productMedia.createMany({
      data: mediaRecords
    });

    // Fetch created media records
    const createdMedia = await prisma.productMedia.findMany({
      where: { productId: id },
      orderBy: { sortOrder: 'asc' }
    });

    res.status(201).json({
      success: true,
      data: { media: createdMedia }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete product media
// @route   DELETE /api/products/:id/media/:mediaId
// @access  Private
router.delete('/:id/media/:mediaId', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id, mediaId } = req.params;

    const media = await prisma.productMedia.findFirst({
      where: { id: mediaId, productId: id }
    });

    if (!media) {
      throw new CustomError('Media not found', 404);
    }

    // Delete file from filesystem
    if (fs.existsSync(media.filePath)) {
      fs.unlinkSync(media.filePath);
    }

    // Delete from database
    await prisma.productMedia.delete({ where: { id: mediaId } });

    res.status(200).json({
      success: true,
      message: 'Media deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Private (Admin/Manager only)
router.delete('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new CustomError('Product not found', 404);
    }

    // Check if product has orders
    const orderCount = await prisma.orderItem.count({ where: { productId: id } });
    if (orderCount > 0) {
      throw new CustomError('Cannot delete product with existing orders. Consider deactivating instead.', 400);
    }

    // Delete associated media files
    const mediaFiles = await prisma.productMedia.findMany({ where: { productId: id } });
    mediaFiles.forEach(media => {
      if (fs.existsSync(media.filePath)) {
        fs.unlinkSync(media.filePath);
      }
    });

    await prisma.product.delete({ where: { id } });

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;