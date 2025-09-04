import jwt from 'jsonwebtoken';
import { Response } from 'express';

interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export const generateTokens = (payload: TokenPayload): Tokens => {
  const accessToken = jwt.sign(
    payload,
    process.env.JWT_SECRET!,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
  );

  const refreshToken = jwt.sign(
    payload,
    process.env.REFRESH_TOKEN_SECRET!,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d' }
  );

  return { accessToken, refreshToken };
};

export const verifyAccessToken = (token: string): TokenPayload => {
  return jwt.verify(token, process.env.JWT_SECRET!) as TokenPayload;
};

export const verifyRefreshToken = (token: string): TokenPayload => {
  return jwt.verify(token, process.env.REFRESH_TOKEN_SECRET!) as TokenPayload;
};

export const sendTokenResponse = (res: Response, statusCode: number, user: any, tokens: Tokens) => {
  const { accessToken, refreshToken } = tokens;

  // Set refresh token as httpOnly cookie
  const cookieOptions = {
    expires: new Date(
      Date.now() + (parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN?.replace('d', '') || '7') * 24 * 60 * 60 * 1000)
    ),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const
  };

  res.cookie('refreshToken', refreshToken, cookieOptions);

  // Remove password from output
  const userResponse = {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt
  };

  res.status(statusCode).json({
    success: true,
    data: {
      user: userResponse,
      accessToken
    }
  });
};