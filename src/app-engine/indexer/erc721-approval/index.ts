import Redis from 'ioredis';

import { AbstractSandboxProcess } from '@/lib/process/sandbox-process.abstract';
import { ProcessOptions } from '@/lib/process/types';

export interface JobData {
  id: string;
}

export interface JobResult {
  id: string;
}

export class Erc721ApprovalEventsQueue extends AbstractSandboxProcess<JobData, JobResult> {
  constructor(db: Redis, options?: ProcessOptions) {
    super(db, `erc721-approval`, `${__dirname}/worker.js`, options);
  }
}
