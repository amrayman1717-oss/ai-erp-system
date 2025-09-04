# AI-Powered ERP System

A comprehensive business management platform with advanced AI capabilities for forecasting, churn detection, OCR processing, and sentiment analysis.

## 🚀 Features

- **Client Management**: Visual product presentation and contract generation
- **Product Catalog**: Centralized catalog with pricing and media management
- **Order Processing**: Automated delivery scheduling and lifecycle management
- **Maintenance Scheduling**: Visit tracking and route optimization
- **AI Analytics**: Sales forecasting, churn prediction, and business insights
- **Document Processing**: OCR-powered invoice and contract analysis
- **Sentiment Analysis**: Customer feedback analysis with emotional insights

## 🏗️ Architecture

### Technology Stack
- **Frontend**: React 18 + TypeScript + Tailwind CSS + Zustand
- **Backend**: Node.js + Express + TypeScript + Prisma ORM
- **Database**: PostgreSQL
- **AI Services**: Python FastAPI microservices
- **Authentication**: JWT with refresh tokens
- **Containerization**: Docker Compose

### Project Structure
```
├── frontend/           # React TypeScript application
├── backend/           # Node.js Express API
├── ai-services/       # Python FastAPI microservices
├── database/          # Database schemas and migrations
├── docker/           # Docker configuration files
└── docs/             # Documentation and API specs
```

## 🛠️ Quick Start

### Prerequisites
- Node.js 18+
- Python 3.9+
- PostgreSQL 14+
- Docker & Docker Compose

### Installation

1. Clone the repository
```bash
git clone https://github.com/amrayman1717-oss/ai-erp-system.git
cd ai-erp-system
```

2. Install dependencies
```bash
# Backend dependencies
cd backend && npm install

# Frontend dependencies
cd ../frontend && npm install

# AI services dependencies
cd ../ai-services && pip install -r requirements.txt
```

3. Set up environment variables
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp ai-services/.env.example ai-services/.env
```

4. Start the development environment
```bash
docker-compose up -d
```

## 📚 Documentation

- [System Architecture](./docs/architecture.md)
- [API Documentation](./docs/api.md)
- [Frontend Guide](./docs/frontend.md)
- [AI Services Guide](./docs/ai-services.md)
- [Deployment Guide](./docs/deployment.md)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.