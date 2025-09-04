import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { CustomError } from '../middleware/errorHandler';

const router = Router();
const prisma = new PrismaClient();

// Apply authentication to all routes
router.use(authenticate);

// @desc    Get dashboard KPIs
// @route   GET /api/analytics/dashboard
// @access  Private
router.get('/dashboard', async (req: AuthenticatedRequest, res, next) => {
  try {
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const orderWhere = { ...where };
    if (startDate || endDate) {
      orderWhere.orderDate = where.createdAt;
      delete orderWhere.createdAt;
    }

    const [totalClients, totalProducts, totalOrders, totalRevenue, recentOrders, topClients] = await Promise.all([
      prisma.client.count({ where: { status: 'ACTIVE' } }),
      prisma.product.count({ where: { isActive: true } }),
      prisma.order.count({ where: orderWhere }),
      prisma.order.aggregate({
        where: orderWhere,
        _sum: { totalAmount: true }
      }),
      prisma.order.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          client: { select: { id: true, name: true } },
          orderItems: {
            take: 1,
            include: {
              product: { select: { name: true } }
            }
          }
        }
      }),
      prisma.client.findMany({
        take: 5,
        include: {
          orders: {
            select: { totalAmount: true }
          }
        }
      })
    ]);

    // Calculate top clients by revenue
    const topClientsByRevenue = topClients
      .map(client => ({
        id: client.id,
        name: client.name,
        totalRevenue: client.orders.reduce((sum, order) => sum + Number(order.totalAmount), 0),
        orderCount: client.orders.length
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 5);

    // Get order status distribution
    const ordersByStatus = await prisma.order.groupBy({
      by: ['status'],
      where: orderWhere,
      _count: { status: true }
    });

    res.status(200).json({
      success: true,
      data: {
        kpis: {
          totalClients,
          totalProducts,
          totalOrders,
          totalRevenue: totalRevenue._sum.totalAmount || 0
        },
        charts: {
          ordersByStatus,
          topClients: topClientsByRevenue
        },
        recentActivity: {
          recentOrders
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get sales trends
// @route   GET /api/analytics/sales-trends
// @access  Private
router.get('/sales-trends', async (req: AuthenticatedRequest, res, next) => {
  try {
    const period = (req.query.period as string) || 'monthly'; // daily, weekly, monthly
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    let dateFormat: string;
    let groupBy: string;

    switch (period) {
      case 'daily':
        dateFormat = 'YYYY-MM-DD';
        groupBy = 'DATE(order_date)';
        break;
      case 'weekly':
        dateFormat = 'YYYY-"W"WW';
        groupBy = 'DATE_TRUNC(\'week\', order_date)';
        break;
      case 'monthly':
      default:
        dateFormat = 'YYYY-MM';
        groupBy = 'DATE_TRUNC(\'month\', order_date)';
        break;
    }

    const where: any = {};
    if (startDate || endDate) {
      where.orderDate = {};
      if (startDate) where.orderDate.gte = new Date(startDate);
      if (endDate) where.orderDate.lte = new Date(endDate);
    }

    // Raw query for better performance with date grouping
    const salesTrends = await prisma.$queryRaw`
      SELECT 
        ${groupBy} as period,
        COUNT(*)::int as order_count,
        SUM(total_amount)::decimal as total_revenue,
        AVG(total_amount)::decimal as avg_order_value
      FROM orders 
      WHERE ${startDate ? 'order_date >= $1::date' : 'TRUE'}
        AND ${endDate ? 'order_date <= $2::date' : 'TRUE'}
      GROUP BY ${groupBy}
      ORDER BY period ASC
    `;

    res.status(200).json({
      success: true,
      data: {
        period,
        trends: salesTrends
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get profitability analysis
// @route   GET /api/analytics/profitability
// @access  Private
router.get('/profitability', async (req: AuthenticatedRequest, res, next) => {
  try {
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const where: any = {};
    if (startDate || endDate) {
      where.order = {
        orderDate: {}
      };
      if (startDate) where.order.orderDate.gte = new Date(startDate);
      if (endDate) where.order.orderDate.lte = new Date(endDate);
    }

    // Product profitability
    const productProfitability = await prisma.orderItem.groupBy({
      by: ['productId'],
      where,
      _sum: {
        quantity: true,
        totalPrice: true
      },
      _count: {
        productId: true
      },
      orderBy: {
        _sum: {
          totalPrice: 'desc'
        }
      },
      take: 20
    });

    // Get product details
    const productIds = productProfitability.map(item => item.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, price: true }
    });

    const productProfitabilityWithDetails = productProfitability.map(item => {
      const product = products.find(p => p.id === item.productId);
      const totalRevenue = Number(item._sum.totalPrice || 0);
      const totalQuantity = item._sum.quantity || 0;
      const averagePrice = totalQuantity > 0 ? totalRevenue / totalQuantity : 0;
      
      return {
        product,
        totalRevenue,
        totalQuantity,
        averagePrice,
        orderCount: item._count.productId,
        profitMargin: product ? ((averagePrice - Number(product.price)) / averagePrice * 100) : 0
      };
    });

    // Client profitability
    const clientProfitability = await prisma.order.groupBy({
      by: ['clientId'],
      where: startDate || endDate ? {
        orderDate: {
          ...(startDate && { gte: new Date(startDate) }),
          ...(endDate && { lte: new Date(endDate) })
        }
      } : {},
      _sum: {
        totalAmount: true
      },
      _count: {
        clientId: true
      },
      orderBy: {
        _sum: {
          totalAmount: 'desc'
        }
      },
      take: 20
    });

    // Get client details
    const clientIds = clientProfitability.map(item => item.clientId);
    const clients = await prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true, monthlyConsumption: true }
    });

    const clientProfitabilityWithDetails = clientProfitability.map(item => {
      const client = clients.find(c => c.id === item.clientId);
      return {
        client,
        totalRevenue: Number(item._sum.totalAmount || 0),
        orderCount: item._count.clientId,
        averageOrderValue: item._count.clientId > 0 ? Number(item._sum.totalAmount || 0) / item._count.clientId : 0
      };
    });

    res.status(200).json({
      success: true,
      data: {
        productProfitability: productProfitabilityWithDetails,
        clientProfitability: clientProfitabilityWithDetails
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get top clients by revenue
// @route   GET /api/analytics/top-clients
// @access  Private
router.get('/top-clients', async (req: AuthenticatedRequest, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const where: any = {};
    if (startDate || endDate) {
      where.orderDate = {};
      if (startDate) where.orderDate.gte = new Date(startDate);
      if (endDate) where.orderDate.lte = new Date(endDate);
    }

    const topClients = await prisma.order.groupBy({
      by: ['clientId'],
      where,
      _sum: {
        totalAmount: true
      },
      _count: {
        clientId: true
      },
      _avg: {
        totalAmount: true
      },
      orderBy: {
        _sum: {
          totalAmount: 'desc'
        }
      },
      take: limit
    });

    // Get client details
    const clientIds = topClients.map(item => item.clientId);
    const clients = await prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        monthlyConsumption: true,
        status: true,
        createdAt: true
      }
    });

    const topClientsWithDetails = topClients.map(item => {
      const client = clients.find(c => c.id === item.clientId);
      return {
        client,
        totalRevenue: Number(item._sum.totalAmount || 0),
        orderCount: item._count.clientId,
        averageOrderValue: Number(item._avg.totalAmount || 0)
      };
    });

    res.status(200).json({
      success: true,
      data: {
        topClients: topClientsWithDetails
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get business alerts
// @route   GET /api/analytics/alerts
// @access  Private
router.get('/alerts', async (req: AuthenticatedRequest, res, next) => {
  try {
    const alerts = [];

    // Low inventory alerts (placeholder - would need inventory tracking)
    // const lowInventoryProducts = await prisma.product.findMany({
    //   where: { inventory: { lt: 10 } }
    // });

    // Overdue invoices
    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        status: 'SENT',
        dueDate: { lt: new Date() }
      },
      include: {
        order: {
          include: {
            client: { select: { id: true, name: true, phone: true } }
          }
        }
      },
      take: 10
    });

    if (overdueInvoices.length > 0) {
      alerts.push({
        type: 'OVERDUE_INVOICES',
        severity: 'HIGH',
        count: overdueInvoices.length,
        message: `${overdueInvoices.length} overdue invoices require attention`,
        data: overdueInvoices
      });
    }

    // Failed deliveries
    const failedDeliveries = await prisma.deliverySchedule.findMany({
      where: {
        status: 'FAILED',
        scheduledDate: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        }
      },
      include: {
        order: {
          include: {
            client: { select: { id: true, name: true, phone: true } }
          }
        }
      }
    });

    if (failedDeliveries.length > 0) {
      alerts.push({
        type: 'FAILED_DELIVERIES',
        severity: 'MEDIUM',
        count: failedDeliveries.length,
        message: `${failedDeliveries.length} deliveries failed in the last 7 days`,
        data: failedDeliveries
      });
    }

    // High churn risk clients (would need AI prediction)
    const highChurnRiskClients = await prisma.churnPrediction.findMany({
      where: {
        riskLevel: 'HIGH',
        isActive: true
      },
      include: {
        client: { select: { id: true, name: true, phone: true } }
      },
      take: 10
    });

    if (highChurnRiskClients.length > 0) {
      alerts.push({
        type: 'HIGH_CHURN_RISK',
        severity: 'HIGH',
        count: highChurnRiskClients.length,
        message: `${highChurnRiskClients.length} clients at high risk of churning`,
        data: highChurnRiskClients
      });
    }

    res.status(200).json({
      success: true,
      data: {
        alerts,
        totalAlerts: alerts.length
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;