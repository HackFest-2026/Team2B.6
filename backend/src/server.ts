import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import path from 'path';
import { rateLimit } from 'express-rate-limit';

import { authRouter } from './routes/auth';
import { workspaceRouter } from './routes/workspaces';
import { documentRouter } from './routes/documents';
import { verificationRouter } from './routes/verification';
import { reportRouter } from './routes/reports';
import { chatRouter } from './routes/chat';
import { demoRouter } from './routes/demo';
import { adminRouter } from './routes/admin';

dotenv.config();

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'verimerge_hackfest_secure_jwt_secret_2026_xyz!';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

// Security & Middlewares
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting for auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests from this IP, please try again later' }
});

// Authentication Middleware
export const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Health Check Endpoint (Required by Section 14)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Verimerge API Engine',
    version: '2.4.0'
  });
});

// Mount Public Routes
app.use('/api/auth', authLimiter, authRouter);

// Mount Protected Routes
app.use('/api/workspaces', authenticateToken, workspaceRouter);
app.use('/api/documents', authenticateToken, documentRouter);
app.use('/api/verification', authenticateToken, verificationRouter);
app.use('/api/reports', authenticateToken, reportRouter);
app.use('/api/chat', authenticateToken, chatRouter);
app.use('/api/demo', authenticateToken, demoRouter);
app.use('/api/admin', authenticateToken, adminRouter);

// Global Error Handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error('Unhandled server error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString()
  });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[VERIMERGE] Backend server running on http://localhost:${PORT}`);
  console.log(`[VERIMERGE] Database: ${process.env.DATABASE_URL || 'file:./dev.db'}`);
  console.log(`[VERIMERGE] Healthcheck: http://localhost:${PORT}/api/health`);
});

export { app, server };
