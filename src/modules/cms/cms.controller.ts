import { Controller } from '@nestjs/common';
import { CmsService } from './cms.service';

// TODO: implement cms endpoints in a later sprint
@Controller('cms')
export class CmsController {
  constructor(private readonly cmsService: CmsService) {}
}
