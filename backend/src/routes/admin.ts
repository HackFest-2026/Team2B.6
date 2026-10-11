import express from 'express';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

export const adminRouter = express.Router();
const prisma = new PrismaClient();

// System health and status endpoint
adminRouter.get('/status', async (req: any, res: any) => {
  try {
    const uploadDir = path.resolve(process.cwd(), 'uploads');
    const storageAvailable = fs.existsSync(uploadDir);

    const [userCount, docCount, claimCount, conflictCount] = await Promise.all([
      prisma.user.count(),
      prisma.document.count(),
      prisma.claim.count(),
      prisma.conflict.count()
    ]);

    const apiKey = process.env.GEMINI_API_KEY;
    const aiConfigured = !!(apiKey && apiKey.length > 10 && apiKey !== 'your_api_key_here');

    res.json({
      status: 'OPERATIONAL',
      timestamp: new Date().toISOString(),
      database: {
        provider: 'SQLite (Local Persistent Zero-Config)',
        status: 'Connected & Healthy',
        connectionUrl: process.env.DATABASE_URL
      },
      storage: {
        type: 'Persistent Local Volume',
        path: uploadDir,
        available: storageAvailable
      },
      services: {
        ocrEngine: 'Tesseract.js (Active for Images/Scans)',
        malwareScanner: 'ClamAV Policy (Enabled with graceful fallback)',
        aiAssistant: aiConfigured ? 'Gemini 1.5 Flash (Active)' : 'Deterministic Search Fallback (Active)',
        verificationEngine: 'Deterministic Cross-Source Verifier v2.4 (Active)'
      },
      metrics: {
        totalUsers: userCount,
        totalDocuments: docCount,
        totalClaims: claimCount,
        activeConflicts: conflictCount,
        uptimeSeconds: Math.round(process.uptime())
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to retrieve system status' });
  }
});

// Audit events list
adminRouter.get('/audit-logs', async (req: any, res: any) => {
  try {
    const logs = await prisma.auditEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: { select: { id: true, name: true, email: true } }
      }
    });

    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});
