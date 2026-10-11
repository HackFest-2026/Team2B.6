import express from 'express';
import { PrismaClient } from '@prisma/client';
import { runWorkspaceVerification } from '../services/verificationEngine';

export const verificationRouter = express.Router();
const prisma = new PrismaClient();

// Trigger verification run for a workspace
verificationRouter.post('/workspace/:workspaceId/verify', async (req: any, res: any) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user.userId;

    const workspace = await prisma.workspace.findFirst({
      where: { id: workspaceId, userId }
    });
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

    const stats = await runWorkspaceVerification(workspaceId, userId);

    await prisma.auditEvent.create({
      data: {
        userId,
        action: 'VERIFY_WORKSPACE',
        entityType: 'Workspace',
        entityId: workspaceId,
        details: `Ran verification: ${stats.verifiedClaims} verified, ${stats.conflictingClaims} conflicts`
      }
    });

    res.json({
      message: 'Verification run completed successfully',
      stats
    });
  } catch (error: any) {
    console.error('Verification run error:', error);
    res.status(500).json({ error: 'Failed to run verification engine' });
  }
});

// Get claims for workspace
verificationRouter.get('/workspace/:workspaceId/claims', async (req: any, res: any) => {
  try {
    const { workspaceId } = req.params;
    const { status, query, includeInvalidated } = req.query;
    const userId = req.user.userId;

    const workspace = await prisma.workspace.findFirst({
      where: { id: workspaceId, userId }
    });
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

    const where: any = { workspaceId };
    if (status && status !== 'All') {
      where.status = String(status);
    } else if (includeInvalidated !== 'true') {
      where.status = { not: 'Invalidated' };
    }

    if (query) {
      where.OR = [
        { claimText: { contains: String(query) } },
        { entity: { contains: String(query) } },
        { value: { contains: String(query) } }
      ];
    }

    const claims = await prisma.claim.findMany({
      where,
      include: {
        citations: {
          include: {
            document: {
              select: { id: true, title: true, classification: true, mimeType: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(claims);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch claims' });
  }
});

// Get conflicts for workspace
verificationRouter.get('/workspace/:workspaceId/conflicts', async (req: any, res: any) => {
  try {
    const { workspaceId } = req.params;
    const { status } = req.query;
    const userId = req.user.userId;

    const workspace = await prisma.workspace.findFirst({
      where: { id: workspaceId, userId }
    });
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

    const where: any = { workspaceId };
    if (status && status !== 'All') {
      where.status = String(status);
    }

    const conflicts = await prisma.conflict.findMany({
      where,
      include: {
        claim1: {
          include: {
            citations: {
              include: {
                document: {
                  select: { id: true, title: true, classification: true, mimeType: true }
                }
              }
            }
          }
        },
        claim2: {
          include: {
            citations: {
              include: {
                document: {
                  select: { id: true, title: true, classification: true, mimeType: true }
                }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(conflicts);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch conflicts' });
  }
});

// Resolve a conflict
verificationRouter.patch('/conflict/:id/resolve', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { resolution, status } = req.body; // status: 'Resolved' | 'Dismissed'

    const conflict = await prisma.conflict.findUnique({
      where: { id },
      include: { workspace: true }
    });

    if (!conflict || conflict.workspace?.userId !== req.user.userId) {
      return res.status(404).json({ error: 'Conflict not found' });
    }

    const updated = await prisma.conflict.update({
      where: { id },
      data: {
        status: status || 'Resolved',
        description: resolution ? `${conflict.description} [Resolution: ${resolution}]` : conflict.description
      }
    });

    res.json({ message: 'Conflict resolved', conflict: updated });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to resolve conflict' });
  }
});

// Get aggregated workspace statistics
verificationRouter.get('/workspace/:workspaceId/stats', async (req: any, res: any) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user.userId;

    const workspace = await prisma.workspace.findFirst({
      where: { id: workspaceId, userId }
    });
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

    const [docCount, allClaims, openConflicts, invalidConflicts, resolvedConflicts, totalConflicts] = await Promise.all([
      prisma.document.count({ where: { workspaceId } }),
      prisma.claim.findMany({ where: { workspaceId } }),
      prisma.conflict.count({ where: { workspaceId, status: 'Open' } }),
      prisma.conflict.count({ where: { workspaceId, status: 'Invalid' } }),
      prisma.conflict.count({ where: { workspaceId, status: 'Resolved' } }),
      prisma.conflict.count({ where: { workspaceId } })
    ]);

    const activeClaims = allClaims.filter(c => c.status !== 'Invalidated' && c.attribute !== 'statement');
    const invalidatedCount = allClaims.filter(c => c.status === 'Invalidated' || c.attribute === 'statement').length;

    const corroboratedCount = activeClaims.filter(c => c.status === 'Corroborated').length;
    const sourceMatchCount = activeClaims.filter(c => c.status === 'Source Match').length;
    const verifiedCount = corroboratedCount + sourceMatchCount;
    const conflictingCount = activeClaims.filter(c => c.status === 'Conflicting').length;
    const reviewCount = activeClaims.filter(c => c.status === 'Needs Review').length;
    const unverifiedCount = activeClaims.filter(c => c.status === 'Unverified').length;

    res.json({
      totalDocuments: docCount,
      totalClaims: activeClaims.length,
      corroboratedClaims: corroboratedCount,
      sourceMatchClaims: sourceMatchCount,
      verifiedClaims: verifiedCount,
      conflictingClaims: conflictingCount,
      needsReviewClaims: reviewCount,
      unverifiedClaims: unverifiedCount,
      invalidatedClaims: invalidatedCount,
      activeConflicts: openConflicts,
      invalidConflicts,
      resolvedConflicts,
      totalConflicts,
      trustScore: activeClaims.length > 0 ? Math.round((verifiedCount / activeClaims.length) * 100) : 100
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch verification statistics' });
  }
});
