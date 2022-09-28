import { ChainId, TransactionFeePhaseRewardsDoc } from '@infinityxyz/lib/types/core';
import { TokenomicsConfigDto } from '@infinityxyz/lib/types/dto';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import FirestoreBatchHandler from '../../firestore/batch-handler';
import { paginatedTransaction } from '../../firestore/paginated-transaction';
import { streamQueryWithRef } from '../../firestore/stream-query';
import { FinalizedUserRaffleEntrant, RaffleEntrant, RaffleState, RaffleTicketTotalsDoc, UserRaffle } from './types';

export async function updateRaffleTicketTotals(raffleRef: FirebaseFirestore.DocumentReference<UserRaffle>) {
  const raffleEntrants = raffleRef.collection('raffleEntrants') as FirebaseFirestore.CollectionReference<RaffleEntrant>;
  const raffle = (await raffleRef.get()).data();

  if (!raffle) {
    throw new Error(`Attempted toi update ticket totals for non-existent raffle ${raffleRef.id}`);
  } else if (raffle?.state === RaffleState.Finalized || raffle?.state === RaffleState.Completed) {
    throw new Error(`Attempted to update ticket totals for finalized raffle ${raffleRef.id}`);
  }

  const totalTicketsRef = raffleRef
    .collection('raffleTotals')
    .doc('raffleTicketTotals') as FirebaseFirestore.DocumentReference<RaffleTicketTotalsDoc>;

  const batch = new FirestoreBatchHandler();
  if (raffle.state === RaffleState.Locked) {
    // finalize the raffle
    // TODO make sure listings/offers have been handled
    await ensureEntrantsAreReadyToBeFinalized(raffleRef.firestore, raffle.activePhaseIds, raffle.chainId);
    let ticketNumber = BigInt(0);
    let numEntrants = 0;
    const res = await paginatedTransaction(
      raffleEntrants,
      raffleRef.firestore,
      { pageSize: 300, maxPages: Number.MAX_SAFE_INTEGER },
      ({ data, txn }) => {
        const entrants = data.docs.map((item) => ({ data: item.data(), ref: item.ref }));
        for (const entrant of entrants) {
          if (!entrant.data.isLedgerAggregated) {
            throw new Error(`Entrant ledger has not been aggregated. ${entrant.ref.path}`);
          }
          entrant.data.numTickets;
          entrant.data.isFinalized = true;
          entrant.data.isAggregated = true;
          if (entrant.data.numTickets > 0) {
            numEntrants += 1;
            const start = ticketNumber;
            const end = ticketNumber + BigInt(entrant.data.numTickets) - BigInt(1);
            const tickets = {
              start: start.toString(),
              end: end.toString()
            };
            (entrant.data as FinalizedUserRaffleEntrant).tickets = tickets;
            ticketNumber = end + BigInt(1);
          }
          txn.set(entrant.ref, { ...entrant.data, updatedAt: Date.now() }, { merge: true });
        }
      }
    );

    if (!res.queryEmpty) {
      throw new Error('Failed to finalize raffle entrants');
    } else {
      const ticketTotalsUpdate: RaffleTicketTotalsDoc = {
        updatedAt: Date.now(),
        totalNumTickets: ticketNumber,
        numUniqueEntrants: numEntrants,
        isAggregated: true,
        totalsUpdatedAt: Date.now(),
        stakerContractAddress: raffle.stakerContractAddress,
        stakerContractChainId: raffle.stakerContractChainId,
        type: raffle.type,
        chainId: raffle.chainId,
        raffleId: raffle.id
      };
      await batch.addAsync(raffleRef, { state: RaffleState.Finalized, updatedAt: Date.now() }, { merge: true });
      await batch.addAsync(totalTicketsRef, ticketTotalsUpdate, { merge: true });
    }
  } else {
    // update totals
    const entrantStream = streamQueryWithRef(raffleEntrants, (_, ref) => [ref], { pageSize: 300 });
    const entrants: { data: RaffleEntrant; ref: FirebaseFirestore.DocumentReference<RaffleEntrant> }[] = [];
    for await (const item of entrantStream) {
      entrants.push(item);
    }

    const totalNumTickets = entrants.reduce((acc, item) => acc + BigInt(item.data.numTickets), BigInt(0));
    const ticketTotalsUpdate: RaffleTicketTotalsDoc = {
      updatedAt: Date.now(),
      totalNumTickets,
      numUniqueEntrants: entrants.length,
      isAggregated: true,
      totalsUpdatedAt: Date.now(),
      stakerContractAddress: raffle.stakerContractAddress,
      stakerContractChainId: raffle.stakerContractChainId,
      type: raffle.type,
      chainId: raffle.chainId,
      raffleId: raffle.id
    };
    for (const entrant of entrants) {
      await batch.addAsync(entrant.ref, { isAggregated: true }, { merge: true });
    }
    await batch.addAsync(totalTicketsRef, ticketTotalsUpdate, { merge: true });
  }
  await batch.flush();
}

async function ensureEntrantsAreReadyToBeFinalized(
  db: FirebaseFirestore.Firestore,
  phaseIds: string[],
  chainId: ChainId
): Promise<void> {
  const tokenomicsRef = db
    .collection(firestoreConstants.REWARDS_COLL)
    .doc(chainId) as FirebaseFirestore.DocumentReference<TokenomicsConfigDto>;
  const tokenomicsSnap = await tokenomicsRef.get();

  const tokenomicsData = tokenomicsSnap.data();

  for (const phaseId of phaseIds) {
    const tokenomicsPhase = (tokenomicsData?.phases ?? []).find((phase) => phase.id === phaseId);
    if (!tokenomicsPhase) {
      throw new Error(`Failed to find tokenomics phase ${phaseId} for chain ${chainId} in tokenomics config`);
    } else if (tokenomicsPhase.isActive) {
      throw new Error(`Entrants are not ready to be finalized. Phase ${phaseId} is still active`);
    }
    const txnFeeRewardDocs = db
      .collectionGroup(firestoreConstants.USER_TXN_FEE_REWARDS_LEDGER_COLL)
      .where('phaseId', '==', phaseId)
      .where('chainId', '==', chainId)
      .where('isAggregated', '==', false);
    const phaseTxnFeeDocs = db
      .collectionGroup(firestoreConstants.USER_REWARD_PHASES_COLL)
      .where('isCopiedToRaffles', '==', false)
      .where('phaseId', '==', phaseId)
      .where('chainId', '==', chainId) as FirebaseFirestore.Query<TransactionFeePhaseRewardsDoc>;

    const txnFeeRewards = await txnFeeRewardDocs.limit(2).get();
    if (txnFeeRewards.size > 0) {
      throw new Error(
        `Entrants are not ready to be finalized. Phase ${phaseId} has not had its txn fee rewards aggregated`
      );
    }

    const phaseTxnFeeRewards = await phaseTxnFeeDocs.limit(2).get();
    if (phaseTxnFeeRewards.size > 0) {
      throw new Error(
        `Entrants are not ready to be finalized. Phase ${phaseId} has not had its txn fee phase rewards aggregated`
      );
    }
  }
}
