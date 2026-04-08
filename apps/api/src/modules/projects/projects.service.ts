import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProjectInput, UpdateProjectInput } from '@link-checker/shared';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const projects = await this.prisma.project.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { links: true, sheetsTasks: true },
        },
      },
    });
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      manualChecking: p.manualChecking,
      sheetsChecking: p.sheetsChecking,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      linksCount: p._count.links,
      sheetsTasksCount: p._count.sheetsTasks,
    }));
  }

  async create(userId: string, dto: CreateProjectInput) {
    return this.prisma.project.create({
      data: {
        userId,
        name: dto.name,
        description: dto.description,
      },
    });
  }

  async getById(userId: string, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, userId },
      include: {
        _count: {
          select: { links: true, sheetsTasks: true },
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async update(userId: string, id: string, dto: UpdateProjectInput) {
    // Ensure ownership before updating
    await this.getById(userId, id);
    return this.prisma.project.update({
      where: { id },
      data: dto,
    });
  }

  async remove(userId: string, id: string) {
    await this.getById(userId, id);
    await this.prisma.project.delete({ where: { id } });
    return { ok: true as const };
  }
}
