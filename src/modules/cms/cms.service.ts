import { Injectable, NotFoundException } from '@nestjs/common';
import { BlogPost, Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { UploadService } from '../upload/upload.service';
import { generateSlug } from '../../common/utils/slug.util';
import { assertImagePublicIdAligned } from '../../common/utils/image-pairing.util';
import {
  buildSkipTake,
  buildPageMeta,
  type PageMeta,
} from '../../common/utils/pagination.util';
import { ErrorCode } from '../../common/constants/error-codes';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { ListBlogPostsQueryDto } from './dto/list-blog-posts-query.dto';

@Injectable()
export class CmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async findAll(
    query: ListBlogPostsQueryDto,
  ): Promise<{ data: BlogPost[]; meta: PageMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.BlogPostWhereInput = {};
    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }
    if (query.isPublished !== undefined) {
      where.isPublished = query.isPublished;
    }

    const [posts, total] = await this.prisma.$transaction([
      this.prisma.blogPost.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...buildSkipTake(page, limit),
      }),
      this.prisma.blogPost.count({ where }),
    ]);

    return { data: posts, meta: buildPageMeta(total, page, limit) };
  }

  async findOne(id: string): Promise<BlogPost> {
    return this.findExisting(id);
  }

  async create(dto: CreateBlogPostDto): Promise<BlogPost> {
    const slug = await this.resolveUniqueSlug(dto.title);
    return this.prisma.blogPost.create({
      data: {
        title: dto.title,
        slug,
        content: dto.content,
        coverImage: dto.coverImage,
        coverImagePublicId: dto.coverImagePublicId,
        isPublished: dto.isPublished ?? false,
      },
    });
  }

  async update(id: string, dto: UpdateBlogPostDto): Promise<BlogPost> {
    assertImagePublicIdAligned(dto.coverImage, dto.coverImagePublicId, {
      image: 'coverImage',
      imagePublicId: 'coverImagePublicId',
    });
    const existing = await this.findExisting(id);

    // Đổi slug theo tiêu đề mới — chỉ khi tiêu đề thực sự đổi, tránh đổi URL bài viết ngoài
    // ý muốn mỗi lần admin chỉ sửa nội dung/ảnh mà không đổi tiêu đề.
    const slug =
      dto.title !== undefined && dto.title !== existing.title
        ? await this.resolveUniqueSlug(dto.title, id)
        : undefined;

    const imageChanged =
      dto.coverImage !== undefined && dto.coverImage !== existing.coverImage;

    const updated = await this.prisma.blogPost.update({
      where: { id },
      data: {
        title: dto.title,
        slug,
        content: dto.content,
        coverImage: dto.coverImage === undefined ? undefined : dto.coverImage,
        coverImagePublicId:
          dto.coverImagePublicId === undefined
            ? undefined
            : dto.coverImagePublicId,
        isPublished: dto.isPublished,
      },
    });

    // Best-effort, chạy SAU khi update DB đã thành công — xem lý do ở banners.service.ts.
    if (imageChanged && existing.coverImagePublicId) {
      await this.uploadService
        .deleteImage(existing.coverImagePublicId)
        .catch(() => undefined);
    }

    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findExisting(id);
    await this.prisma.blogPost.delete({ where: { id } });

    if (existing.coverImagePublicId) {
      await this.uploadService
        .deleteImage(existing.coverImagePublicId)
        .catch(() => undefined);
    }
  }

  private async findExisting(id: string): Promise<BlogPost> {
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) {
      throw new NotFoundException({
        message: 'Không tìm thấy bài viết',
        code: ErrorCode.CMS_BLOG_POST_NOT_FOUND,
      });
    }
    return post;
  }

  private async resolveUniqueSlug(
    source: string,
    excludeId?: string,
  ): Promise<string> {
    const base = generateSlug(source);
    let candidate = base;
    let suffix = 2;

    while (
      await this.prisma.blogPost.findFirst({
        where: {
          slug: candidate,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      })
    ) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }
}
