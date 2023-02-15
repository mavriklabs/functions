import Redis from 'ioredis';

import { ChainId } from '@infinityxyz/lib/types/core';

import { ProcessOptions } from '@/lib/process/types';

import { AbstractOrderbookProcessor } from '../orderbook-processor';

interface JobData {
  id: string;
  queryNum: number;
  isSellOrder: boolean;
  concurrentReservoirRequests: number;
  chainId: ChainId;
  numQueries: number;
}

interface JobResult {
  numOrders: number;
}

export class ValidateOrdersProcessor extends AbstractOrderbookProcessor<JobData, JobResult> {
  constructor(id: string, redis: Redis, firestore: FirebaseFirestore.Firestore, options?: ProcessOptions) {
    super(id, redis, firestore, `${__dirname}/worker.js`, options);
  }
}
