import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_PANEL_ROLES } from '../../common/constants/admin-panel-roles';
import { CmsService } from './cms.service';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { ListBlogPostsQueryDto } from './dto/list-blog-posts-query.dto';

@ApiTags('cms')
@ApiBearerAuth()
@Controller('cms/blog-posts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CmsController {
  constructor(private readonly cmsService: CmsService) {}

  @Get()
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({
    summary:
      'Danh sách bài viết (tìm theo tiêu đề, lọc trạng thái, phân trang)',
  })
  findAll(@Query() query: ListBlogPostsQueryDto) {
    return this.cmsService.findAll(query);
  }

  @Get(':id')
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Chi tiết 1 bài viết' })
  findOne(@Param('id') id: string) {
    return this.cmsService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Tạo bài viết mới (Admin, Marketing)' })
  create(@Body() dto: CreateBlogPostDto) {
    return this.cmsService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Cập nhật bài viết (Admin, Marketing)' })
  update(@Param('id') id: string, @Body() dto: UpdateBlogPostDto) {
    return this.cmsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Xóa bài viết (Admin, Marketing)' })
  remove(@Param('id') id: string) {
    return this.cmsService.remove(id);
  }
}
