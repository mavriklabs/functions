import { ChainId } from '@infinityxyz/lib/types/core';
import { firestoreConstants, ONE_MIN } from '@infinityxyz/lib/utils';
import * as functions from 'firebase-functions';
import { getDb } from '../../firestore';
import FirestoreBatchHandler from '../../firestore/batch-handler';
import { streamQueryWithRef } from '../../firestore/stream-query';
import { Epoch, Phase, RewardProgram, TradingReward } from '../../rewards/epoch.type';
import { TransactionFeeReward } from '../../rewards/reward-program-handlers/transaction-fee-handler';
import { getEpochByPhase } from '../../rewards/utils';
import { REGION } from '../../utils/constants';
import { calculateStats } from '../aggregate-sales-stats/utils';
import { aggregateTransactionFeeRewards } from './aggregate-transaction-fee-rewards';

export const onUserTransactionFeeRewardEvent = functions
  .region(REGION)
  .firestore.document(
    `${firestoreConstants.USERS_COLL}/{userId}/userRewards/{chainId}/userTransactionFeeRewardsLedger/{eventId}`
  ) // TODO constants
  .onWrite(async (snapshot) => {
    const event = snapshot.after.data() as TransactionFeeReward;
    if (!event || event.isAggregated) {
      return;
    }

    await aggregateTransactionFeeRewards(
      snapshot.after.ref.parent as FirebaseFirestore.CollectionReference<TransactionFeeReward>,
      event.chainId
    );
  });

export const triggerUserTransactionFeeRewardAggregation = functions
  .region(REGION)
  .pubsub.schedule('every 5 minutes')
  .onRun(async () => {
    const db = getDb();
    const maxAge = ONE_MIN * 5;
    const unaggregatedUserRewardsQuery = db
      .collectionGroup('userTransactionFeeRewardsLedger')
      .where('isAggregated', '==', false)
      .where('updatedAt', '<', Date.now() - maxAge)
      .orderBy('updatedAt', 'asc');
    const unaggregatedUserRewardsStream = streamQueryWithRef(unaggregatedUserRewardsQuery, (_, ref) => [ref], {
      pageSize: 300
    });

    const triggeredLedgerPaths = new Set();
    const batch = new FirestoreBatchHandler();
    for await (const { ref } of unaggregatedUserRewardsStream) {
      const ledgerRef = ref.parent;
      if (!triggeredLedgerPaths.has(ledgerRef.path)) {
        batch.add(ref, { updatedAt: Date.now() }, { merge: true });
        triggeredLedgerPaths.add(ledgerRef.path);
      }
    }
    await batch.flush();
  });


export interface TransactionFeePhaseRewardsDoc {
  epoch: Epoch;
  chainId: ChainId;
  phase: Phase;
  tradingFeeRewards: Omit<TradingReward, 'rewardSupplyUsed'> | null;
  nftRewards: Omit<TradingReward, 'rewardSupplyUsed'> | null;
  rewards: number;
  volume: number;
  updatedAt: number;
}

export interface AllTimeTransactionFeeRewardsDoc {
  chainId: ChainId;
  rewards: number;
  volume: number;
  updatedAt: number;
}
