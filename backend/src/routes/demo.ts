import express from 'express';
import { createDemoWorkspace } from '../services/demoWorkspace';

export const demoRouter = express.Router();

demoRouter.post('/load', async (req: any, res: any) => {
  try {
    const userId = req.user.userId;
    const result = await createDemoWorkspace(userId);

    res.json({
      message: 'HackFest demonstration workspace loaded and verified successfully',
      workspaceId: result.workspace.id,
      reportId: result.reportId,
      stats: result.stats
    });
  } catch (error: any) {
    console.error('Demo load error:', error);
    res.status(500).json({ error: error.message || 'Failed to initialize demo workspace' });
  }
});
