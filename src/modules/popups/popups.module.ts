import { Module } from '@nestjs/common';
import { UploadModule } from '../upload/upload.module';
import { PopupsController } from './popups.controller';
import { PopupsService } from './popups.service';

@Module({
  imports: [UploadModule],
  controllers: [PopupsController],
  providers: [PopupsService],
  exports: [PopupsService],
})
export class PopupsModule {}
