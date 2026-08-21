import {
  BadRequestException,
  Controller,
  Delete,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UploadService } from './upload.service';
import { ErrorCode } from '../../common/constants/error-codes';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

const MAX_VIDEO_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'];

@ApiTags('upload')
@ApiBearerAuth()
@Controller('upload')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.WAREHOUSE_STAFF, UserRole.MARKETING)
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('image')
  @ApiOperation({
    summary: 'Upload ảnh lên Cloudinary (Admin, tối đa 5MB, jpg/png/webp)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Trả về url và publicId của ảnh trên Cloudinary',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          callback(
            new BadRequestException({
              message: 'Chỉ chấp nhận ảnh định dạng .jpg, .jpeg, .png, .webp',
              code: ErrorCode.UPLOAD_IMAGE_INVALID_TYPE,
            }),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException({
        message: 'Vui lòng chọn file ảnh để upload',
        code: ErrorCode.UPLOAD_IMAGE_FILE_REQUIRED,
      });
    }
    return this.uploadService.uploadImage(file);
  }

  @Delete('image/:publicId')
  @ApiOperation({ summary: 'Xóa ảnh trên Cloudinary theo publicId (Admin)' })
  deleteImage(@Param('publicId') publicId: string) {
    return this.uploadService.deleteImage(publicId);
  }

  @Post('video')
  @ApiOperation({
    summary: 'Upload video lên Cloudinary (Admin, tối đa 10MB, mp4/webm)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Trả về url và publicId của video trên Cloudinary',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_VIDEO_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_VIDEO_MIME_TYPES.includes(file.mimetype)) {
          callback(
            new BadRequestException({
              message: 'Chỉ chấp nhận video định dạng .mp4, .webm',
              code: ErrorCode.UPLOAD_VIDEO_INVALID_TYPE,
            }),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  uploadVideo(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException({
        message: 'Vui lòng chọn file video để upload',
        code: ErrorCode.UPLOAD_VIDEO_FILE_REQUIRED,
      });
    }
    return this.uploadService.uploadVideo(file);
  }

  @Delete('video/:publicId')
  @ApiOperation({ summary: 'Xóa video trên Cloudinary theo publicId (Admin)' })
  deleteVideo(@Param('publicId') publicId: string) {
    return this.uploadService.deleteVideo(publicId);
  }
}
