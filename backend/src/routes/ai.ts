import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { CustomError } from '../middleware/errorHandler';
import { body, validationResult } from 'express-validator';
import axios from 'axios';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();
const prisma = new PrismaClient();

// Apply authentication to all routes
router.use(authenticate);

// Multer configuration for OCR file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/ocr';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'ocr-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760') // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images and PDF files are allowed for OCR processing'));
    }
  }
});

// AI Services base URL
const AI_SERVICES_URL = process.env.AI_SERVICES_URL || 'http://localhost:8000';

// Helper function to make AI service requests
const makeAIRequest = async (endpoint: string, data: any, timeout = 30000) => {
  try {
    const response = await axios.post(`${AI_SERVICES_URL}${endpoint}`, data, {
      timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      throw new CustomError('AI services are currently unavailable', 503);
    }
    throw new CustomError(error.response?.data?.message || 'AI service error', error.response?.status || 500);
  }
};

// @desc    Sales forecasting
// @route   POST /ai/forecast
// @access  Private
router.post('/forecast', [
  body('clientId').optional().isUUID(),
  body('period').isIn(['daily', 'weekly', 'monthly']).withMessage('Period must be daily, weekly, or monthly'),
  body('forecastDays').isInt({ min: 1, max: 365 }).withMessage('Forecast days must be between 1 and 365')
], async (req: AuthenticatedRequest, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new CustomError('Validation failed', 400);
    }

    const { clientId, period, forecastDays } = req.body;

    // Get historical sales data
    const where: any = {};
    if (clientId) {
      where.clientId = clientId;
    }

    // Get last 2 years of data for better forecasting
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 2);
    where.orderDate = { gte: startDate };

    const historicalData = await prisma.order.findMany({
      where,
      select: {
        orderDate: true,
        totalAmount: true,
        client: clientId ? { select: { id: true, name: true } } : undefined
      },
      orderBy: { orderDate: 'asc' }
    });

    if (historicalData.length < 10) {
      throw new CustomError('Insufficient historical data for forecasting (minimum 10 orders required)', 400);
    }

    // Prepare data for AI service
    const forecastData = {
      historical_data: historicalData.map(order => ({
        date: order.orderDate.toISOString().split('T')[0],
        amount: Number(order.totalAmount)
      })),
      period,
      forecast_days: forecastDays,
      client_id: clientId || null
    };

    // Call AI forecasting service
    const forecast = await makeAIRequest('/forecast', forecastData);

    // Store forecast in database
    const forecastRecords = forecast.predictions.map((prediction: any) => ({
      clientId: clientId || null,
      forecastDate: new Date(prediction.date),
      predictedAmount: prediction.amount,
      confidenceInterval: prediction.confidence || 0.95,
      modelMetadata: {
        period,
        model_type: forecast.model_type || 'prophet',
        accuracy_metrics: forecast.accuracy_metrics || {}
      }
    }));

    await prisma.salesForecast.createMany({
      data: forecastRecords
    });

    res.status(200).json({
      success: true,
      data: {
        forecast: forecast.predictions,
        metadata: {
          model_type: forecast.model_type,
          accuracy_metrics: forecast.accuracy_metrics,
          confidence_level: forecast.confidence_level
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Churn detection
// @route   POST /ai/churn
// @access  Private
router.post('/churn', [
  body('clientIds').optional().isArray(),
  body('clientIds.*').optional().isUUID()
], async (req: AuthenticatedRequest, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new CustomError('Validation failed', 400);
    }

    const { clientIds } = req.body;

    // Get client data for analysis
    const where: any = { status: 'ACTIVE' };
    if (clientIds && clientIds.length > 0) {
      where.id = { in: clientIds };
    }

    const clients = await prisma.client.findMany({
      where,
      include: {
        orders: {
          select: {
            totalAmount: true,
            orderDate: true,
            status: true
          },
          orderBy: { orderDate: 'desc' }
        },
        visitsCalls: {
          select: {
            type: true,
            visitDate: true,
            outcome: true
          },
          orderBy: { visitDate: 'desc' }
        },
        feedback: {
          select: {
            rating: true,
            sentiment: true,
            createdAt: true
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (clients.length === 0) {
      throw new CustomError('No clients found for analysis', 404);
    }

    // Prepare client features for AI analysis
    const clientFeatures = clients.map(client => {
      const now = new Date();
      const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

      const recentOrders = client.orders.filter(order => order.orderDate >= threeMonthsAgo);
      const olderOrders = client.orders.filter(order => order.orderDate >= sixMonthsAgo && order.orderDate < threeMonthsAgo);
      
      return {
        client_id: client.id,
        days_since_signup: Math.floor((now.getTime() - client.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
        total_orders: client.orders.length,
        recent_orders_3m: recentOrders.length,
        older_orders_3m: olderOrders.length,
        avg_order_value: client.orders.length > 0 ? client.orders.reduce((sum, order) => sum + Number(order.totalAmount), 0) / client.orders.length : 0,
        days_since_last_order: client.orders.length > 0 ? Math.floor((now.getTime() - client.orders[0].orderDate.getTime()) / (1000 * 60 * 60 * 24)) : 999,
        total_visits_calls: client.visitsCalls.length,
        avg_feedback_rating: client.feedback.length > 0 ? client.feedback.reduce((sum, fb) => sum + fb.rating, 0) / client.feedback.length : 3,
        monthly_consumption: Number(client.monthlyConsumption || 0)
      };
    });

    // Call AI churn detection service
    const churnAnalysis = await makeAIRequest('/churn', { clients: clientFeatures });

    // Store churn predictions in database
    const churnRecords = churnAnalysis.predictions.map((prediction: any) => {
      let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      if (prediction.churn_score >= 0.8) riskLevel = 'CRITICAL';
      else if (prediction.churn_score >= 0.6) riskLevel = 'HIGH';
      else if (prediction.churn_score >= 0.4) riskLevel = 'MEDIUM';
      else riskLevel = 'LOW';

      return {
        clientId: prediction.client_id,
        churnScore: prediction.churn_score,
        riskLevel,
        riskFactors: prediction.risk_factors || {},
        predictionDate: new Date()
      };
    });

    // Deactivate old predictions and create new ones
    await prisma.$transaction(async (tx) => {
      await tx.churnPrediction.updateMany({
        where: {
          clientId: { in: churnRecords.map(r => r.clientId) },
          isActive: true
        },
        data: { isActive: false }
      });

      await tx.churnPrediction.createMany({
        data: churnRecords
      });
    });

    res.status(200).json({
      success: true,
      data: {
        predictions: churnAnalysis.predictions,
        metadata: {
          model_type: churnAnalysis.model_type,
          accuracy_metrics: churnAnalysis.accuracy_metrics
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    OCR document processing
// @route   POST /ai/ocr
// @access  Private
router.post('/ocr', upload.single('document'), async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.file) {
      throw new CustomError('No document file provided', 400);
    }

    const { documentType = 'invoice' } = req.body;

    // Read file and convert to base64 for AI service
    const fileBuffer = fs.readFileSync(req.file.path);
    const base64File = fileBuffer.toString('base64');

    // Call AI OCR service
    const ocrResult = await makeAIRequest('/ocr', {
      file_data: base64File,
      file_type: req.file.mimetype,
      document_type: documentType
    }, 60000); // 60 second timeout for OCR

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.status(200).json({
      success: true,
      data: {
        extracted_text: ocrResult.extracted_text,
        structured_data: ocrResult.structured_data || {},
        confidence: ocrResult.confidence || 0,
        processing_time: ocrResult.processing_time || 0
      }
    });
  } catch (error) {
    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    next(error);
  }
});

// @desc    Sentiment analysis
// @route   POST /ai/sentiment
// @access  Private
router.post('/sentiment', [
  body('text').isLength({ min: 1 }).withMessage('Text is required for sentiment analysis'),
  body('feedbackId').optional().isUUID()
], async (req: AuthenticatedRequest, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new CustomError('Validation failed', 400);
    }

    const { text, feedbackId } = req.body;

    // Call AI sentiment analysis service
    const sentimentResult = await makeAIRequest('/sentiment', { text });

    // Update feedback record if feedbackId is provided
    if (feedbackId) {
      await prisma.feedback.update({
        where: { id: feedbackId },
        data: {
          sentiment: sentimentResult.sentiment?.toUpperCase() || 'NEUTRAL',
          sentimentScore: sentimentResult.score || 0,
          isProcessed: true
        }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        sentiment: sentimentResult.sentiment,
        score: sentimentResult.score,
        confidence: sentimentResult.confidence,
        emotions: sentimentResult.emotions || {},
        processing_time: sentimentResult.processing_time || 0
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Chatbot interaction
// @route   POST /ai/chatbot
// @access  Private
router.post('/chatbot', [
  body('message').isLength({ min: 1 }).withMessage('Message is required'),
  body('context').optional().isObject()
], async (req: AuthenticatedRequest, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new CustomError('Validation failed', 400);
    }

    const { message, context = {} } = req.body;

    // Add user context
    const chatContext = {
      ...context,
      user_id: req.user!.id,
      user_role: req.user!.role,
      timestamp: new Date().toISOString()
    };

    // Call AI chatbot service
    const chatbotResponse = await makeAIRequest('/chatbot', {
      message,
      context: chatContext
    });

    res.status(200).json({
      success: true,
      data: {
        response: chatbotResponse.response,
        intent: chatbotResponse.intent,
        confidence: chatbotResponse.confidence,
        suggested_actions: chatbotResponse.suggested_actions || [],
        processing_time: chatbotResponse.processing_time || 0
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get AI service status
// @route   GET /ai/status
// @access  Private
router.get('/status', async (req: AuthenticatedRequest, res, next) => {
  try {
    const services = ['forecast', 'churn', 'ocr', 'sentiment', 'chatbot'];
    const statusChecks = await Promise.allSettled(
      services.map(service => 
        axios.get(`${AI_SERVICES_URL}/health/${service}`, { timeout: 5000 })
      )
    );

    const serviceStatus = services.map((service, index) => ({
      service,
      status: statusChecks[index].status === 'fulfilled' ? 'online' : 'offline',
      error: statusChecks[index].status === 'rejected' 
        ? (statusChecks[index] as PromiseRejectedResult).reason.message 
        : null
    }));

    const overallStatus = serviceStatus.every(s => s.status === 'online') ? 'healthy' : 'degraded';

    res.status(200).json({
      success: true,
      data: {
        overall_status: overallStatus,
        services: serviceStatus,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;