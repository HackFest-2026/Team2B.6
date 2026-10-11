import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { extractDocumentText, computeFileHash } from '../services/extractor';

export const documentRouter = express.Router();
const prisma = new PrismaClient();

// Ensure upload directory exists
const uploadDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer safe disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Sanitize filename to prevent directory traversal
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}-${cleanName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

// Upload multiple documents
documentRouter.post('/upload', upload.array('documents', 20), async (req: any, res: any) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files provided for upload' });
    }

    const userId = req.user.userId;
    let workspaceId = req.body.workspaceId;
    const classification = req.body.classification || 'Internal';

    // If no workspaceId provided, get or create default workspace
    if (!workspaceId) {
      let defaultWs = await prisma.workspace.findFirst({ where: { userId } });
      if (!defaultWs) {
        defaultWs = await prisma.workspace.create({
          data: { name: 'Main Workspace', userId }
        });
      }
      workspaceId = defaultWs.id;
    }

    const savedDocs = [];

    for (const file of files) {
      const fileHash = computeFileHash(file.path);

      // Check if duplicate file already uploaded by this user
      const existingDoc = await prisma.document.findFirst({
        where: {
          userId,
          fileHash
        }
      });

      const isDuplicate = !!existingDoc;
      const limitationNotes = isDuplicate 
        ? `Duplicate file detected (identical SHA-256 hash to "${existingDoc.title}")`
        : null;

      // Create document record
      const doc = await prisma.document.create({
        data: {
          workspaceId,
          title: file.originalname,
          originalName: file.originalname,
          mimeType: file.mimetype || 'application/octet-stream',
          size: file.size,
          fileHash,
          storagePath: file.path,
          classification,
          status: 'Pending',
          extractionStatus: 'Pending',
          limitationNotes,
          userId
        }
      });

      // Run extraction in background or inline
      try {
        const extraction = await extractDocumentText(file.path, file.originalname, file.mimetype);
        const updated = await prisma.document.update({
          where: { id: doc.id },
          data: {
            extractedText: extraction.text,
            pageCount: extraction.pageCount,
            wordCount: extraction.wordCount,
            status: extraction.status === 'Extracted' || extraction.status === 'OCR_Fallback' ? 'Completed' : 'Failed',
            extractionStatus: extraction.status,
            limitationNotes: extraction.limitationNotes || limitationNotes
          }
        });
        savedDocs.push(updated);
      } catch (extErr: any) {
        const failed = await prisma.document.update({
          where: { id: doc.id },
          data: {
            status: 'Failed',
            extractionStatus: 'Failed',
            limitationNotes: `Extraction exception: ${extErr.message}`
          }
        });
        savedDocs.push(failed);
      }

      // Audit log
      await prisma.auditEvent.create({
        data: {
          userId,
          action: 'UPLOAD_DOCUMENT',
          entityType: 'Document',
          entityId: doc.id,
          details: `Uploaded "${file.originalname}" (${file.size} bytes, class: ${classification})`
        }
      });
    }

    res.json({
      message: `${savedDocs.length} file(s) ingested and processed successfully`,
      documents: savedDocs
    });
  } catch (error: any) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload documents' });
  }
});

// List documents with search and filtering
documentRouter.get('/', async (req: any, res: any) => {
  try {
    const { workspaceId, query, classification, status } = req.query;
    const where: any = { userId: req.user.userId };

    if (workspaceId) where.workspaceId = String(workspaceId);
    if (classification) where.classification = String(classification);
    if (status) where.status = String(status);
    if (query) {
      where.OR = [
        { title: { contains: String(query) } },
        { originalName: { contains: String(query) } }
      ];
    }

    const documents = await prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        workspace: { select: { id: true, name: true } },
        _count: { select: { citations: true } }
      }
    });

    res.json(documents);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Get single document details with citations
documentRouter.get('/:id', async (req: any, res: any) => {
  try {
    const document = await prisma.document.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
      include: {
        workspace: true,
        citations: {
          include: {
            claim: true
          }
        }
      }
    });

    if (!document) return res.status(404).json({ error: 'Document not found' });
    res.json(document);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

// Retry extraction for all failed documents without duplicate uploads
documentRouter.post('/retry-failed', async (req: any, res: any) => {
  try {
    const failedDocs = await prisma.document.findMany({
      where: {
        userId: req.user.userId,
        OR: [
          { status: 'Failed' },
          { extractionStatus: 'Failed' }
        ]
      }
    });

    const results = [];
    for (const doc of failedDocs) {
      try {
        const extraction = await extractDocumentText(doc.storagePath, doc.originalName, doc.mimeType);
        const updated = await prisma.document.update({
          where: { id: doc.id },
          data: {
            extractedText: extraction.text,
            pageCount: extraction.pageCount,
            wordCount: extraction.wordCount,
            status: extraction.status === 'Extracted' || extraction.status === 'OCR_Fallback' ? 'Completed' : 'Failed',
            extractionStatus: extraction.status,
            limitationNotes: extraction.limitationNotes || null
          }
        });
        results.push(updated);
      } catch (err: any) {
        results.push({ id: doc.id, error: err.message });
      }
    }

    res.json({ message: `Retried ${failedDocs.length} failed document(s)`, documents: results });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to retry documents' });
  }
});

// Trigger extraction manually
documentRouter.post('/:id/extract', async (req: any, res: any) => {
  try {
    const document = await prisma.document.findFirst({
      where: { id: req.params.id, userId: req.user.userId }
    });

    if (!document) return res.status(404).json({ error: 'Document not found' });

    const extraction = await extractDocumentText(document.storagePath, document.originalName, document.mimeType);
    const updated = await prisma.document.update({
      where: { id: document.id },
      data: {
        extractedText: extraction.text,
        pageCount: extraction.pageCount,
        wordCount: extraction.wordCount,
        status: extraction.status === 'Extracted' || extraction.status === 'OCR_Fallback' ? 'Completed' : 'Failed',
        extractionStatus: extraction.status,
        limitationNotes: extraction.limitationNotes || null
      }
    });

    res.json({ message: 'Extraction completed', document: updated });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to extract text' });
  }
});

// Delete document
documentRouter.delete('/:id', async (req: any, res: any) => {
  try {
    const document = await prisma.document.findFirst({
      where: { id: req.params.id, userId: req.user.userId }
    });

    if (!document) return res.status(404).json({ error: 'Document not found' });

    if (fs.existsSync(document.storagePath)) {
      try { fs.unlinkSync(document.storagePath); } catch (e) {}
    }

    await prisma.document.delete({ where: { id: req.params.id } });

    await prisma.auditEvent.create({
      data: {
        userId: req.user.userId,
        action: 'DELETE_DOCUMENT',
        entityType: 'Document',
        entityId: req.params.id,
        details: `Deleted "${document.title}"`
      }
    });

    res.json({ message: 'Document deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete document' });
  }
});
