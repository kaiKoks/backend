import { Body, Controller, Post } from '@nestjs/common';
import { CheckerService } from './checker.service.js';
import { CheckRuleRequestDto, CheckRuleResponseDto } from '../../common/dto/check-rule.dto.js';

@Controller('api/checker')
export class CheckerController {
  constructor(private readonly checkerService: CheckerService) {}

  @Post('test-rule')
  async testRule(@Body() dto: CheckRuleRequestDto): Promise<CheckRuleResponseDto> {
    return this.checkerService.checkRule(dto);
  }
}
export class CheckerModule {}