import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/prisma.js';
import { hashPassword, verifyPassword, generateToken, verifyToken, encryptZ7iPassword, decryptZ7iPassword } from './lib/auth.js';
import { z7iLogin } from './lib/z7i-service.js';

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function handleRegister(req: VercelRequest, res: VercelResponse) {
  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    const hashedPassword = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        name: name || null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        themeMode: true,
        themeCustomEnabled: true,
        themeAccent: true,
        themeAccentSecondary: true,
        themeSuccess: true,
        themeError: true,
        themeWarning: true,
        themeUnattempted: true
      }
    });

    const token = generateToken({ userId: user.id, email: user.email });
    return res.status(201).json({ success: true, user, token });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleLogin(req: VercelRequest, res: VercelResponse) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        z7iAccount: {
          select: { id: true, enrollmentNo: true, lastSyncAt: true, syncStatus: true }
        }
      }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const ipAddress = req.headers['x-forwarded-for'] as string || req.headers['x-real-ip'] as string || 'unknown';
    await prisma.user.update({
      where: { id: user.id },
      data: { lastIpAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress.split(',')[0].trim() }
    });

    const token = generateToken({ userId: user.id, email: user.email });
    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        z7iLinked: !!user.z7iAccount,
        z7iEnrollment: user.z7iAccount?.enrollmentNo,
        lastSyncAt: user.z7iAccount?.lastSyncAt,
        canUseAiSolutions: user.canUseAiSolutions,
        canAccessAiChatRoom: user.canAccessAiChatRoom,
        themeMode: user.themeMode,
        themeCustomEnabled: user.themeCustomEnabled,
        themeAccent: user.themeAccent,
        themeAccentSecondary: user.themeAccentSecondary,
        themeSuccess: user.themeSuccess,
        themeError: user.themeError,
        themeWarning: user.themeWarning,
        themeUnattempted: user.themeUnattempted
      },
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleMe(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        z7iAccount: {
          select: { id: true, enrollmentNo: true, lastSyncAt: true, syncStatus: true }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const ipAddress = req.headers['x-forwarded-for'] as string || req.headers['x-real-ip'] as string || 'unknown';
    await prisma.user.update({
      where: { id: user.id },
      data: { lastIpAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress.split(',')[0].trim() }
    });

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        z7iLinked: !!user.z7iAccount,
        z7iEnrollment: user.z7iAccount?.enrollmentNo,
        lastSyncAt: user.z7iAccount?.lastSyncAt,
        syncStatus: user.z7iAccount?.syncStatus,
        canUseAiSolutions: user.canUseAiSolutions,
        canAccessAiChatRoom: user.canAccessAiChatRoom,
        themeMode: user.themeMode,
        themeCustomEnabled: user.themeCustomEnabled,
        themeAccent: user.themeAccent,
        themeAccentSecondary: user.themeAccentSecondary,
        themeSuccess: user.themeSuccess,
        themeError: user.themeError,
        themeWarning: user.themeWarning,
        themeUnattempted: user.themeUnattempted
      },
    });
  } catch (error) {
    console.error('Me error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleUpdateProfile(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { name, currentPassword, newPassword } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updateData: { name?: string; password?: string } = {};

    if (name !== undefined) {
      updateData.name = name || null;
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required to change password' });
      }

      const isValid = await verifyPassword(currentPassword, user.password);
      if (!isValid) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
      }

      updateData.password = await hashPassword(newPassword);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: payload.userId },
      data: updateData,
      select: { id: true, email: true, name: true }
    });

    return res.status(200).json({
      success: true,
      user: updatedUser,
      message: newPassword ? 'Profile and password updated' : 'Profile updated'
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function validateThemeColor(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !HEX_COLOR_REGEX.test(value)) {
    throw new Error('Invalid color value');
  }
  return value;
}

async function handleUpdateTheme(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const {
    themeMode,
    themeCustomEnabled,
    themeAccent,
    themeAccentSecondary,
    themeSuccess,
    themeError,
    themeWarning,
    themeUnattempted
  } = req.body;

  try {
    const updateData: {
      themeMode?: string;
      themeCustomEnabled?: boolean;
      themeAccent?: string | null;
      themeAccentSecondary?: string | null;
      themeSuccess?: string | null;
      themeError?: string | null;
      themeWarning?: string | null;
      themeUnattempted?: string | null;
    } = {};

    if (themeMode !== undefined) {
      if (themeMode !== 'dark' && themeMode !== 'light') {
        return res.status(400).json({ error: 'Invalid theme mode' });
      }
      updateData.themeMode = themeMode;
    }

    if (themeCustomEnabled !== undefined) {
      if (typeof themeCustomEnabled !== 'boolean') {
        return res.status(400).json({ error: 'Invalid custom theme toggle' });
      }
      updateData.themeCustomEnabled = themeCustomEnabled;
    }

    if (
      themeAccent !== undefined ||
      themeAccentSecondary !== undefined ||
      themeSuccess !== undefined ||
      themeError !== undefined ||
      themeWarning !== undefined ||
      themeUnattempted !== undefined
    ) {
      try {
        updateData.themeAccent = validateThemeColor(themeAccent);
        updateData.themeAccentSecondary = validateThemeColor(themeAccentSecondary);
        updateData.themeSuccess = validateThemeColor(themeSuccess);
        updateData.themeError = validateThemeColor(themeError);
        updateData.themeWarning = validateThemeColor(themeWarning);
        updateData.themeUnattempted = validateThemeColor(themeUnattempted);
      } catch (error) {
        if (error instanceof Error && error.message === 'Invalid color value') {
          return res.status(400).json({ error: 'Theme colors must be valid hex values' });
        }
        throw error;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No theme updates provided' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: payload.userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        themeMode: true,
        themeCustomEnabled: true,
        themeAccent: true,
        themeAccentSecondary: true,
        themeSuccess: true,
        themeError: true,
        themeWarning: true,
        themeUnattempted: true
      }
    });

    return res.status(200).json({
      success: true,
      user: updatedUser,
      message: 'Theme updated'
    });
  } catch (error) {
    console.error('Update theme error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleUpdateZ7i(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { enrollmentNo, z7iPassword } = req.body;

  if (!enrollmentNo || !z7iPassword) {
    return res.status(400).json({ error: 'Enrollment number and Z7I password are required' });
  }

  try {
    const loginResult = await z7iLogin(enrollmentNo, z7iPassword);
    if (!loginResult) {
      return res.status(400).json({ error: 'Invalid Z7I credentials. Please check and try again.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { z7iAccount: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const encryptedPassword = encryptZ7iPassword(z7iPassword);

    if (user.z7iAccount) {
      await prisma.z7iAccount.update({
        where: { id: user.z7iAccount.id },
        data: { 
          enrollmentNo, 
          encryptedPassword,
          syncStatus: 'pending' // Mark for re-sync
        }
      });
    } else {
      await prisma.z7iAccount.create({
        data: {
          userId: user.id,
          enrollmentNo,
          encryptedPassword,
          syncStatus: 'pending'
        }
      });
    }

    return res.status(200).json({
      success: true,
      enrollmentNo,
      message: 'Z7I credentials updated successfully'
    });
  } catch (error) {
    console.error('Update Z7I error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleUnlinkZ7i(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { z7iAccount: true }
    });

    if (!user || !user.z7iAccount) {
      return res.status(400).json({ error: 'No Z7I account linked' });
    }

    await prisma.z7iAccount.delete({
      where: { id: user.z7iAccount.id }
    });

    return res.status(200).json({
      success: true,
      message: 'Z7I account unlinked. All synced data has been removed.'
    });
  } catch (error) {
    console.error('Unlink Z7I error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleDeleteAccount(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password is required to delete account' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      return res.status(400).json({ error: 'Incorrect password' });
    }

    await prisma.user.delete({
      where: { id: payload.userId }
    });

    return res.status(200).json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    console.error('Delete account error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = req.query.action as string;

  switch (action) {
    case 'register':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleRegister(req, res);
    case 'login':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleLogin(req, res);
    case 'me':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleMe(req, res);
    case 'update-profile':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleUpdateProfile(req, res);
    case 'update-theme':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleUpdateTheme(req, res);
    case 'update-z7i':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleUpdateZ7i(req, res);
    case 'unlink-z7i':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleUnlinkZ7i(req, res);
    case 'delete-account':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleDeleteAccount(req, res);
    default:
      return res.status(400).json({ error: 'Invalid action' });
  }
}
