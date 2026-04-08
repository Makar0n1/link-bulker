import { Body, Controller, Get, Post, Res, UseGuards, HttpCode } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { LoginInput, type SessionUser } from '@link-checker/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService, SESSION_COOKIE_NAME } from './auth.service';
import { SessionGuard } from './session.guard';
import { isProd } from '../../config/env';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(LoginInput)) dto: LoginInput,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<{ user: SessionUser }> {
    const user = await this.authService.login(dto.email, dto.password);
    res.setCookie(SESSION_COOKIE_NAME, user.id, {
      httpOnly: true,
      secure: isProd(),
      sameSite: 'lax',
      path: '/',
      signed: true,
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return { user };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: FastifyReply): { ok: true } {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: SessionUser): { user: SessionUser } {
    return { user };
  }
}
