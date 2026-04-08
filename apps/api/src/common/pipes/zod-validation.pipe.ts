import { PipeTransform, BadRequestException } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Validate body/query against a Zod schema.
 *
 * Usage:
 *   @Post()
 *   create(@Body(new ZodValidationPipe(CreateProjectInput)) dto: CreateProjectInput) { ... }
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: result.error.flatten(),
      });
    }
    return result.data;
  }
}
