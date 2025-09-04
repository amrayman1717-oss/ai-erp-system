import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Layout from './components/Layout/Layout';
import LoginPage from './pages/Auth/LoginPage';
import Dashboard from './pages/Dashboard/Dashboard';
import ClientList from './pages/Clients/ClientList';
import ClientDetail from './pages/Clients/ClientDetail';
import ClientForm from './pages/Clients/ClientForm';
import ProductList from './pages/Products/ProductList';
import ProductDetail from './pages/Products/ProductDetail';
import ProductForm from './pages/Products/ProductForm';
import OrderList from './pages/Orders/OrderList';
import OrderDetail from './pages/Orders/OrderDetail';
import OrderForm from './pages/Orders/OrderForm';
import AnalyticsDashboard from './pages/Analytics/AnalyticsDashboard';
import SalesTrends from './pages/Analytics/SalesTrends';
import ProfitabilityAnalysis from './pages/Analytics/ProfitabilityAnalysis';
import ForecastingPage from './pages/AI/ForecastingPage';
import ChurnAnalysis from './pages/AI/ChurnAnalysis';
import OCRProcessing from './pages/AI/OCRProcessing';
import SentimentAnalysis from './pages/AI/SentimentAnalysis';
import LoadingSpinner from './components/UI/LoadingSpinner';

function App() {
  const { isAuthenticated, isLoading, user } = useAuthStore();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        {/* Dashboard */}
        <Route path="/" element={<Dashboard />} />
        <Route path="/dashboard" element={<Dashboard />} />

        {/* Client Management */}
        <Route path="/clients" element={<ClientList />} />
        <Route path="/clients/new" element={<ClientForm />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route path="/clients/:id/edit" element={<ClientForm />} />

        {/* Product Management */}
        <Route path="/products" element={<ProductList />} />
        <Route path="/products/new" element={<ProductForm />} />
        <Route path="/products/:id" element={<ProductDetail />} />
        <Route path="/products/:id/edit" element={<ProductForm />} />

        {/* Order Management */}
        <Route path="/orders" element={<OrderList />} />
        <Route path="/orders/new" element={<OrderForm />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/orders/daily" element={<OrderForm />} />

        {/* Analytics */}
        <Route path="/analytics" element={<AnalyticsDashboard />} />
        <Route path="/analytics/sales" element={<SalesTrends />} />
        <Route path="/analytics/profitability" element={<ProfitabilityAnalysis />} />

        {/* AI Features */}
        <Route path="/ai/forecast" element={<ForecastingPage />} />
        <Route path="/ai/churn" element={<ChurnAnalysis />} />
        <Route path="/ai/ocr" element={<OCRProcessing />} />
        <Route path="/ai/sentiment" element={<SentimentAnalysis />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default App;