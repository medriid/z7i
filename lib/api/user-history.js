import { prisma } from './prisma.js';

export async function logUserHistoryAction(input) {
  try {
    await prisma.userActionHistory.create({
      data: {
        userId: input.userId,
        actionType: input.actionType,
        title: input.title,
        description: input.description ?? null,
        metadata: input.metadata ?? undefined,
      },
    });
  } catch (error) {
    console.error('Failed to write user action history:', error);
  }
}
