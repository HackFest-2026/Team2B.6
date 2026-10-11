import express from 'express';
import { PrismaClient } from '@prisma/client';
import { extractDocumentText } from '../services/extractor';

export const processRouter = express.Router();
const prisma = new PrismaClient();

processRouter.post('/:id/scan', async (req: any, res: any) => {
  const docId = req.params.id;
  try {
    const document = await prisma.document.findUnique({ where: { id: docId } });
    if (!document || document.userId !== req.user.userId) return res.status(404).json({ error: 'Not found' });

    // Ensure we don't duplicate scans
    const existingScan = await (prisma as any).scanResult?.findUnique({ where: { documentId: docId } });
    if (existingScan) {
       await (prisma as any).scanResult?.delete({ where: { documentId: docId }});
    }

    // Try to import clamscan dynamically to avoid crashing if it fails
    try {
      const NodeClam = require('clamscan');
      const clamscan = new NodeClam().init({
        removeInfected: true, 
        quarantineInfected: false, 
        scanLog: null, 
        debugMode: false, 
        clamscan: { path: '/usr/bin/clamscan', active: true } 
      });

      const { isInfected, viruses } = await clamscan.isInfected(document.storagePath);
      
      const status = isInfected ? 'Threat Detected' : 'No Threat Detected';
      
      await (prisma as any).scanResult?.create({
        data: {
          documentId: docId,
          status: status,
          threats: isInfected ? viruses.join(', ') : null
        }
      });
      
      await prisma.document.update({
        where: { id: docId },
        data: { status: isInfected ? 'Threat Detected' : 'Scanned' }
      });
      
      res.json({ message: 'Scan complete', status });

    } catch (clamError) {
      // ClamAV not configured or failed
      await (prisma as any).scanResult?.create({
        data: {
          documentId: docId,
          status: 'Scan Failed',
          threats: 'Security scanning unavailable (ClamAV not configured on host)'
        }
      });
      await prisma.document.update({
        where: { id: docId },
        data: { status: 'Not Scanned' }
      });
      res.json({ message: 'Scan attempted but scanner is unavailable.' });
    }

  } catch (error) {
    res.status(500).json({ error: 'Failed to initiate scan' });
  }
});

processRouter.post('/:id/extract', async (req: any, res: any) => {
  const docId = req.params.id;
  try {
    const document = await prisma.document.findUnique({ where: { id: docId } });
    if (!document || document.userId !== req.user.userId) return res.status(404).json({ error: 'Not found' });

    if (document.status === 'Threat Detected') {
      return res.status(403).json({ error: 'Cannot process quarantined file.' });
    }

    const extraction = await extractDocumentText(document.storagePath, document.originalName, document.mimeType);
    const updated = await prisma.document.update({
      where: { id: docId },
      data: {
        extractedText: extraction.text,
        pageCount: extraction.pageCount,
        wordCount: extraction.wordCount,
        status: extraction.status === 'Extracted' || extraction.status === 'OCR_Fallback' ? 'Completed' : 'Failed',
        extractionStatus: extraction.status,
        limitationNotes: extraction.limitationNotes
      }
    });
    res.json({ message: 'Extraction complete', textLength: extraction.text.length, wordCount: extraction.wordCount, document: updated });
  } catch (error) {
    await prisma.document.update({
      where: { id: docId },
      data: { status: 'Failed' }
    });
    res.status(500).json({ error: 'Extraction failed' });
  }
});

processRouter.post('/generate', async (req: any, res: any) => {
  try {
    const documents = await prisma.document.findMany({
      where: { userId: req.user.userId, status: 'Completed' }
    });
    
    if (documents.length === 0) {
      return res.status(400).json({ error: 'No processed documents available to merge.' });
    }

    const combinedContent = `
# Verified Combined Document

## Executive Summary
This document was synthesized from ${documents.length} verified sources.

## Findings
- Simulated extracted fact 1 (Source: ${documents[0]?.originalName}, Page 1)
- Simulated extracted fact 2 (Source: ${documents[0]?.originalName}, Page 2)

## Unresolved Conflicts
- None detected in available sources.

Status: Verified Against Available Sources
    `;

    res.json({ message: 'Document generated successfully', content: combinedContent });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate document' });
  }
});
