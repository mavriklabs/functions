import { StakerEvents } from '@infinityxyz/lib/types/core';
import { firestoreConstants } from '@infinityxyz/lib/utils/constants';
import * as functions from 'firebase-functions';
import { getDb } from '../firestore';
import FirestoreBatchHandler from '../firestore/batch-handler';
import { streamQueryWithRef } from '../firestore/stream-query';
import { REGION } from '../utils/constants';
import { handleStakerEvent } from './handle-staker-event';

export const onStakerEvent = functions
  .region(REGION)
  .runWith({
    timeoutSeconds: 540
  })
  .firestore.document(`${firestoreConstants.STAKING_LEDGER_COLL}/{txnHash}`)
  .onWrite(async (change) => {
    const event = change.after.data() as StakerEvents | undefined;

    if (!event) {
      throw new Error(`No event data found`);
    }

    if(!event.processed) {
      const db = getDb();
      await handleStakerEvent(event, db, change.after.ref as FirebaseFirestore.DocumentReference<StakerEvents>);
    }
  });

export const triggerStakerEvents = functions.region(REGION).runWith({ timeoutSeconds: 540 }).pubsub.schedule('0,10,20,30,40,50 * * * *').onRun(async () => {
  const db = getDb();
  const stakingLedger = db.collection(firestoreConstants.STAKING_LEDGER_COLL);
  const fiveMin = 1000 * 60 * 5;
  const maxProcessingDelay = fiveMin;
  const unProcessedStakingEvents = stakingLedger.where('updatedAt', '<', Date.now() - maxProcessingDelay).where('processed', '==', false) as FirebaseFirestore.Query<StakerEvents>;
  const stream = streamQueryWithRef(unProcessedStakingEvents, (item, ref) => [ref], { pageSize: 300 });
  let numTriggered = 0;
  const batch = new FirestoreBatchHandler();
  for await(const item of stream) {
    const trigger: Partial<StakerEvents> = {
      updatedAt: Date.now()
    }
    batch.add(item.ref, trigger, { merge: true });
    numTriggered += 1;
  }
  await batch.flush();
  console.log(`Trigger staker events triggered ${numTriggered} events to be processed`);
});
