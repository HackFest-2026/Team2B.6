import express from 'express';
import { PrismaClient } from '@prisma/client';
import { answerQuestionFromDocuments } from '../services/chatService';

export const chatRouter = express.Router();
const prisma = new PrismaClient();

chatRouter.post('/', async (req: any, res: any) => {
  try {
    const { message, workspaceId } = req.body;
    const userId = req.user.userId;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    const response = await answerQuestionFromDocuments(message, userId, workspaceId);
    const resolvedWsId = response.workspaceId || workspaceId || null;

    // Save user message to database
    await prisma.chatMessage.create({
      data: {
        userId,
        workspaceId: resolvedWsId,
        role: 'user',
        content: message
      }
    });

    // Save assistant response to database
    await prisma.chatMessage.create({
      data: {
        userId,
        workspaceId: resolvedWsId,
        role: 'assistant',
        content: response.reply,
        citationsJson: JSON.stringify(response.citations)
      }
    });

    res.json(response);
  } catch (error: any) {
    console.error('Chat router error:', error);
    res.status(500).json({ error: 'Failed to process chat query' });
  }
});

// Chat history endpoint
chatRouter.get('/history', async (req: any, res: any) => {
  try {
    const { workspaceId } = req.query;
    const userId = req.user.userId;

    const messages = await prisma.chatMessage.findMany({
      where: {
        userId,
        ...(workspaceId ? { workspaceId: String(workspaceId) } : {})
      },
      orderBy: { createdAt: 'asc' },
      take: 50
    });

    res.json(messages);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});
