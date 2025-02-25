import Redis from 'ioredis';

import { ProcessOptions } from '@/lib/process/types';

import { AbstractOrderbookProcessor } from '../orderbook-processor';

export interface JobData {
  id: string;
  queryNum: number;
  numQueries: number;
}

export interface JobResult {
  numOrders: number;
}

export class UpdateOrderStatusEventsProcessor extends AbstractOrderbookProcessor<JobData, JobResult> {
  constructor(id: string, redis: Redis, firestore: FirebaseFirestore.Firestore, options?: ProcessOptions) {
    super(id, redis, firestore, `${__dirname}/worker.js`, options);
  }
}
