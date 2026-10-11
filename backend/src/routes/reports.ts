import express from 'express';
import { PrismaClient } from '@prisma/client';
import { composeCombinedDocument } from '../services/composer';
import { exportReportAsPdf, exportReportAsDocx, exportReportAsCsv } from '../services/exporter';

export const reportRouter = express.Router();
const prisma = new PrismaClient();

// Generate a combined verifiable report
reportRouter.post('/workspace/:workspaceId/generate', async (req: any, res: any) => {
  try {
    const { workspaceId } = req.params;
    const { title } = req.body;
    const userId = req.user.userId;

    const workspace = await prisma.workspace.findFirst({
      where: { id: workspaceId, userId }
    });
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

    const report = await composeCombinedDocument(workspaceId, userId, title);

    await prisma.auditEvent.create({
      data: {
        userId,
        action: 'GENERATE_REPORT',
        entityType: 'CombinedReport',
        entityId: report.id,
        details: `Generated verifiable report "${report.title}"`
      }
    });

    res.json({ message: 'Combined report composed successfully', report });
  } catch (error: any) {
    console.error('Report composition error:', error);
    res.status(500).json({ error: error.message || 'Failed to compose combined document' });
  }
});

// List reports for a workspace
reportRouter.get('/workspace/:workspaceId', async (req: any, res: any) => {
  try {
    const { workspaceId } = req.params;
    const reports = await prisma.combinedReport.findMany({
      where: { workspaceId, userId: req.user.userId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(reports);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// Get single report
reportRouter.get('/:id', async (req: any, res: any) => {
  try {
    const report = await prisma.combinedReport.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
      include: {
        workspace: {
          include: {
            documents: true,
            claims: { include: { citations: { include: { document: true } } } },
            conflicts: {
              include: {
                claim1: { include: { citations: { include: { document: true } } } },
                claim2: { include: { citations: { include: { document: true } } } }
              }
            }
          }
        }
      }
    });

    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

// Export report in multiple formats: PDF, DOCX, CSV, MD, JSON
reportRouter.get('/:id/export/:format', async (req: any, res: any) => {
  try {
    const { id, format } = req.params;
    const userId = req.user.userId;

    const report = await prisma.combinedReport.findFirst({
      where: { id, userId }
    });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const safeTitle = report.title.replace(/[^a-zA-Z0-9_-]/g, '_');

    await prisma.auditEvent.create({
      data: {
        userId,
        action: 'EXPORT_REPORT',
        entityType: 'CombinedReport',
        entityId: id,
        details: `Exported report "${report.title}" in format ${format.toUpperCase()}`
      }
    });

    if (format === 'pdf') {
      const pdfBuffer = await exportReportAsPdf(id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.pdf"`);
      return res.send(pdfBuffer);
    }

    if (format === 'docx') {
      const docxBuffer = await exportReportAsDocx(id);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.docx"`);
      return res.send(docxBuffer);
    }

    if (format === 'csv') {
      const csvString = await exportReportAsCsv(id);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}_evidence_ledger.csv"`);
      return res.send(csvString);
    }

    if (format === 'md') {
      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.md"`);
      return res.send(report.markdownContent);
    }

    if (format === 'json') {
      const fullReport = await prisma.combinedReport.findFirst({
        where: { id },
        include: {
          workspace: {
            include: {
              documents: true,
              claims: { include: { citations: { include: { document: true } } } },
              conflicts: true
            }
          }
        }
      });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}_ledger.json"`);
      return res.send(JSON.stringify(fullReport, null, 2));
    }

    res.status(400).json({ error: `Unsupported export format: ${format}. Choose from: pdf, docx, csv, md, json` });
  } catch (error: any) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to export document' });
  }
});
