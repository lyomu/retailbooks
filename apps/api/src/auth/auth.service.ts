import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActionTokenPurpose,
  AuthProvider,
  SessionStatus,
  UserStatus,
  type Prisma,
} from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import { createOpaqueToken, hashPassword, hashToken, verifyPassword } from './auth.crypto.js';
import { AuthMailerService } from './auth-mailer.service.js';
import type { LoginDto, ResetPasswordDto, SignupDto } from './auth.dto.js';
import type { RequestMetadata } from './request-context.js';

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_ROTATION_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_SESSIONS = 10;

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  status: UserStatus;
}

export interface SessionContext {
  sessionId: string;
  user: PublicUser;
  rotatedToken?: string;
}

@Injectable()
export class AuthService {
  private readonly securityPepper: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: AuthMailerService,
    config: ConfigService,
  ) {
    this.securityPepper = config.get('SECURITY_PEPPER') ?? 'local-development-pepper-change-me';
    if (config.get('NODE_ENV') === 'production' && this.securityPepper.length < 32) {
      throw new Error('SECURITY_PEPPER must contain at least 32 characters in production.');
    }
  }

  get pepper(): string {
    return this.securityPepper;
  }

  /**
   * Internal bootstrap path for deterministic fixtures. It is deliberately not exposed by an HTTP
   * controller: normal accounts must prove possession of their email through `verifyEmail`.
   */
  async provisionVerifiedUserForBootstrap(
    input: SignupDto,
    metadata: RequestMetadata,
  ): Promise<PublicUser> {
    const passwordHash = await hashPassword(input.password);
    const verifiedAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email: input.email },
        create: {
          email: input.email,
          displayName: input.displayName,
          emailVerifiedAt: verifiedAt,
          status: UserStatus.ACTIVE,
        },
        update: {
          displayName: input.displayName,
          emailVerifiedAt: verifiedAt,
          status: UserStatus.ACTIVE,
        },
      });
      await tx.authMethod.upsert({
        where: { userId_provider: { userId: user.id, provider: AuthProvider.PASSWORD } },
        create: { userId: user.id, provider: AuthProvider.PASSWORD, passwordHash },
        update: { passwordHash },
      });
      await tx.actionToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: verifiedAt },
      });
      await this.securityEvent(tx, user.id, 'auth.bootstrap_verified', metadata, {
        outcome: 'provisioned',
      });
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        emailVerified: true,
        status: user.status,
      };
    });
  }

  async signup(input: SignupDto, metadata: RequestMetadata): Promise<{ message: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });

    if (existing) {
      if (existing.status === UserStatus.PENDING_VERIFICATION) {
        const token = await this.issueActionToken(
          existing.id,
          ActionTokenPurpose.VERIFY_EMAIL,
          VERIFY_TOKEN_TTL_MS,
        );
        await this.mailer.sendVerification(existing.email, existing.displayName, token);
      }
      return { message: 'Check your email for the next step.' };
    }

    const passwordHash = await hashPassword(input.password);
    const rawToken = createOpaqueToken();
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          displayName: input.displayName,
          authMethods: {
            create: { provider: AuthProvider.PASSWORD, passwordHash },
          },
          actionTokens: {
            create: {
              purpose: ActionTokenPurpose.VERIFY_EMAIL,
              tokenHash: hashToken(rawToken),
              expiresAt,
            },
          },
        },
      });
      await this.securityEvent(tx, created.id, 'auth.signup', metadata, { outcome: 'created' });
      return created;
    });

    await this.mailer.sendVerification(user.email, user.displayName, rawToken);
    return { message: 'Check your email for the next step.' };
  }

  async resendVerification(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.status === UserStatus.PENDING_VERIFICATION) {
      const token = await this.issueActionToken(
        user.id,
        ActionTokenPurpose.VERIFY_EMAIL,
        VERIFY_TOKEN_TTL_MS,
      );
      await this.mailer.sendVerification(user.email, user.displayName, token);
    }
    return { message: 'If the account needs verification, a new email is on its way.' };
  }

  async verifyEmail(rawToken: string, metadata: RequestMetadata): Promise<{ message: string }> {
    const token = await this.prisma.actionToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: true },
    });

    if (
      !token ||
      token.purpose !== ActionTokenPurpose.VERIFY_EMAIL ||
      token.consumedAt ||
      token.expiresAt <= new Date()
    ) {
      throw new BadRequestException('This verification link is invalid or has expired.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.actionToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
      await tx.actionToken.updateMany({
        where: {
          userId: token.userId,
          purpose: ActionTokenPurpose.VERIFY_EMAIL,
          consumedAt: null,
          id: { not: token.id },
        },
        data: { consumedAt: new Date() },
      });
      await tx.user.update({
        where: { id: token.userId },
        data: { emailVerifiedAt: new Date(), status: UserStatus.ACTIVE },
      });
      await this.securityEvent(tx, token.userId, 'auth.email_verified', metadata, {});
    });

    return { message: 'Email verified. You can now sign in.' };
  }

  async login(
    input: LoginDto,
    metadata: RequestMetadata,
  ): Promise<{ token: string; user: PublicUser }> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { authMethods: { where: { provider: AuthProvider.PASSWORD } } },
    });
    const method = user?.authMethods[0];

    if (!user || !method?.passwordHash) {
      await hashPassword(input.password);
      throw new UnauthorizedException('Email or password is incorrect.');
    }

    const passwordMatches = await verifyPassword(method.passwordHash, input.password).catch(
      () => false,
    );
    if (!passwordMatches) {
      await this.prisma.securityEvent.create({
        data: {
          userId: user.id,
          eventKey: 'auth.login_failed',
          severity: 'WARNING',
          ipHash: metadata.ipHash,
          metadata: { reason: 'invalid_credentials' },
        },
      });
      throw new UnauthorizedException('Email or password is incorrect.');
    }

    if (user.status === UserStatus.PENDING_VERIFICATION) {
      throw new ForbiddenException('Verify your email before signing in.');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('This account is not available.');
    }

    const session = await this.createSession(user.id, metadata);
    await this.prisma.securityEvent.create({
      data: {
        userId: user.id,
        eventKey: 'auth.login_succeeded',
        ipHash: metadata.ipHash,
        metadata: { sessionId: session.id },
      },
    });

    return { token: session.rawToken, user: toPublicUser(user) };
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.status === UserStatus.ACTIVE) {
      const token = await this.issueActionToken(
        user.id,
        ActionTokenPurpose.RESET_PASSWORD,
        RESET_TOKEN_TTL_MS,
      );
      await this.mailer.sendPasswordReset(user.email, user.displayName, token);
    }
    return { message: 'If an account matches that email, a reset link is on its way.' };
  }

  async resetPassword(
    input: ResetPasswordDto,
    metadata: RequestMetadata,
  ): Promise<{ message: string }> {
    const actionToken = await this.prisma.actionToken.findUnique({
      where: { tokenHash: hashToken(input.token) },
    });

    if (
      !actionToken ||
      actionToken.purpose !== ActionTokenPurpose.RESET_PASSWORD ||
      actionToken.consumedAt ||
      actionToken.expiresAt <= new Date()
    ) {
      throw new BadRequestException('This reset link is invalid or has expired.');
    }

    const passwordHash = await hashPassword(input.password);
    await this.prisma.$transaction(async (tx) => {
      await tx.authMethod.update({
        where: { userId_provider: { userId: actionToken.userId, provider: AuthProvider.PASSWORD } },
        data: { passwordHash },
      });
      await tx.actionToken.updateMany({
        where: {
          userId: actionToken.userId,
          purpose: ActionTokenPurpose.RESET_PASSWORD,
          consumedAt: null,
        },
        data: { consumedAt: new Date() },
      });
      await tx.session.updateMany({
        where: { userId: actionToken.userId, status: SessionStatus.ACTIVE },
        data: { status: SessionStatus.REVOKED, revokedAt: new Date() },
      });
      await this.securityEvent(tx, actionToken.userId, 'auth.password_reset', metadata, {
        sessionsRevoked: true,
      });
    });

    return { message: 'Password updated. Sign in with your new password.' };
  }

  async authenticate(rawToken: string | null): Promise<SessionContext> {
    if (!rawToken) throw new UnauthorizedException('Sign in to continue.');

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: true },
    });
    if (!session || session.status !== SessionStatus.ACTIVE) {
      throw new UnauthorizedException('Your session is no longer valid.');
    }
    if (session.expiresAt <= new Date()) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { status: SessionStatus.EXPIRED },
      });
      throw new UnauthorizedException('Your session has expired.');
    }
    if (session.user.status !== UserStatus.ACTIVE) {
      await this.revokeSession(session.id, session.userId);
      throw new UnauthorizedException('Your session is no longer valid.');
    }

    const shouldRotate = Date.now() - session.lastSeenAt.getTime() >= SESSION_ROTATION_MS;
    if (shouldRotate) {
      const rotatedToken = createOpaqueToken();
      const rotation = await this.prisma.session.updateMany({
        where: { id: session.id, tokenHash: hashToken(rawToken) },
        data: { tokenHash: hashToken(rotatedToken), lastSeenAt: new Date() },
      });
      return {
        sessionId: session.id,
        user: toPublicUser(session.user),
        ...(rotation.count === 1 ? { rotatedToken } : {}),
      };
    }

    if (Date.now() - session.lastSeenAt.getTime() >= 5 * 60 * 1000) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    }
    return { sessionId: session.id, user: toPublicUser(session.user) };
  }

  async logout(rawToken: string | null): Promise<void> {
    if (!rawToken) return;
    await this.prisma.session.updateMany({
      where: { tokenHash: hashToken(rawToken), status: SessionStatus.ACTIVE },
      data: { status: SessionStatus.REVOKED, revokedAt: new Date() },
    });
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, status: SessionStatus.ACTIVE, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, userAgent: true, lastSeenAt: true, createdAt: true, expiresAt: true },
    });
    return sessions.map((session) => ({ ...session, current: session.id === currentSessionId }));
  }

  async revokeSession(sessionId: string, userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId, status: SessionStatus.ACTIVE },
      data: { status: SessionStatus.REVOKED, revokedAt: new Date() },
    });
  }

  async revokeOtherSessions(userId: string, currentSessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, id: { not: currentSessionId }, status: SessionStatus.ACTIVE },
      data: { status: SessionStatus.REVOKED, revokedAt: new Date() },
    });
  }

  private async issueActionToken(
    userId: string,
    purpose: ActionTokenPurpose,
    ttlMs: number,
  ): Promise<string> {
    const rawToken = createOpaqueToken();
    await this.prisma.$transaction([
      this.prisma.actionToken.updateMany({
        where: { userId, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.actionToken.create({
        data: {
          userId,
          purpose,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + ttlMs),
        },
      }),
    ]);
    return rawToken;
  }

  private async createSession(userId: string, metadata: RequestMetadata) {
    const activeSessions = await this.prisma.session.findMany({
      where: { userId, status: SessionStatus.ACTIVE },
      orderBy: { lastSeenAt: 'asc' },
      select: { id: true },
    });
    if (activeSessions.length >= MAX_ACTIVE_SESSIONS) {
      const overflow = activeSessions.slice(0, activeSessions.length - MAX_ACTIVE_SESSIONS + 1);
      await this.prisma.session.updateMany({
        where: { id: { in: overflow.map(({ id }) => id) } },
        data: { status: SessionStatus.REVOKED, revokedAt: new Date() },
      });
    }

    const rawToken = createOpaqueToken();
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        userAgent: metadata.userAgent,
        ipHash: metadata.ipHash,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return { id: session.id, rawToken };
  }

  private securityEvent(
    tx: Prisma.TransactionClient,
    userId: string,
    eventKey: string,
    metadata: RequestMetadata,
    details: Prisma.InputJsonObject,
  ) {
    return tx.securityEvent.create({
      data: { userId, eventKey, ipHash: metadata.ipHash, metadata: details },
    });
  }
}

function toPublicUser(user: {
  id: string;
  email: string;
  displayName: string;
  emailVerifiedAt: Date | null;
  status: UserStatus;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: Boolean(user.emailVerifiedAt),
    status: user.status,
  };
}
