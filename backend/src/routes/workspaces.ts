import express from 'express';
import { PrismaClient } from '@prisma/client';

export const workspaceRouter = express.Router();
const prisma = new PrismaClient();

// List workspaces for user
workspaceRouter.get('/', async (req: any, res: any) => {
  try {
    const workspaces = await prisma.workspace.findMany({
      where: { userId: req.user.userId },
      include: {
        _count: {
          select: {
            documents: true,
            claims: true,
            conflicts: true,
            reports: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(workspaces);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch workspaces' });
  }
});

// Create workspace
workspaceRouter.post('/', async (req: any, res: any) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Workspace name is required' });

    const workspace = await prisma.workspace.create({
      data: {
        name,
        description: description || null,
        userId: req.user.userId
      }
    });

    await prisma.auditEvent.create({
      data: {
        userId: req.user.userId,
        action: 'CREATE_WORKSPACE',
        entityType: 'Workspace',
        entityId: workspace.id,
        details: `Workspace "${workspace.name}" created`
      }
    });

    res.json(workspace);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create workspace' });
  }
});

// Get single workspace with stats
workspaceRouter.get('/:id', async (req: any, res: any) => {
  try {
    const workspace = await prisma.workspace.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
      include: {
        documents: { orderBy: { createdAt: 'desc' } },
        claims: {
          include: { citations: { include: { document: true } } },
          orderBy: { createdAt: 'desc' }
        },
        conflicts: {
          include: {
            claim1: { include: { citations: { include: { document: true } } } },
            claim2: { include: { citations: { include: { document: true } } } }
          }
        },
        reports: { orderBy: { createdAt: 'desc' } }
      }
    });

    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    res.json(workspace);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch workspace details' });
  }
});

// Delete workspace
workspaceRouter.delete('/:id', async (req: any, res: any) => {
  try {
    const workspace = await prisma.workspace.findFirst({
      where: { id: req.params.id, userId: req.user.userId }
    });
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

    await prisma.workspace.delete({ where: { id: req.params.id } });
    res.json({ message: 'Workspace deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete workspace' });
  }
});
