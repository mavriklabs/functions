import { constants } from 'ethers';
import PQueue from 'p-queue';

import { OrderEventKind, RawFirestoreOrderWithoutError } from '@infinityxyz/lib/types/core';
import { firestoreConstants, sleep } from '@infinityxyz/lib/utils';
import { Flow } from '@reservoir0x/sdk';

import { getDb } from '@/firestore/db';
import { streamQueryWithRef } from '@/firestore/stream-query';
import { CollRef, Query } from '@/firestore/types';
import { logger } from '@/lib/logger';
import { Erc721ApprovalEventData } from '@/lib/on-chain-events/erc721/erc721-approval';
import { Erc721ApprovalForAllEventData } from '@/lib/on-chain-events/erc721/erc721-approval-for-all';
import { Erc721TransferEventData } from '@/lib/on-chain-events/erc721/erc721-transfer';
import { ContractEvent, ContractEventKind } from '@/lib/on-chain-events/types';
import { NftEventKind, NftTransferEvent } from '@/lib/tokens/transfers/types';

import { validateOrders } from './validate-orders';

export async function* erc721TransferEvents() {
  const db = getDb();
  const contractEvents = db.collectionGroup('contractEvents');

  const transfers = contractEvents
    .where('metadata.processed', '==', false)
    .where('metadata.eventKind', '==', ContractEventKind.Erc721Transfer) as Query<
    ContractEvent<Erc721TransferEventData>
  >;

  const stream = streamQueryWithRef(transfers);

  for await (const { data, ref } of stream) {
    yield { data, ref };
  }
}

export async function* erc721ApprovalEvents() {
  const db = getDb();
  const contractEvents = db.collectionGroup('contractEvents');

  const transfers = contractEvents
    .where('metadata.processed', '==', false)
    .where('metadata.eventKind', '==', ContractEventKind.Erc721Approval) as Query<
    ContractEvent<Erc721ApprovalEventData>
  >;

  const stream = streamQueryWithRef(transfers);

  for await (const { data, ref } of stream) {
    yield { data, ref };
  }
}

export async function* erc721ApprovalForAllEvents() {
  const db = getDb();
  const contractEvents = db.collectionGroup('contractEvents');

  const transfers = contractEvents
    .where('metadata.processed', '==', false)
    .where('metadata.eventKind', '==', ContractEventKind.Erc721ApprovalForAll) as Query<
    ContractEvent<Erc721ApprovalForAllEventData>
  >;

  const stream = streamQueryWithRef(transfers);

  for await (const { data, ref } of stream) {
    yield { data, ref };
  }
}

export async function handleErc721ApprovalEvents(signal?: { abort: boolean }) {
  const iterator = erc721ApprovalEvents();

  const queue = new PQueue({ concurrency: 30 });
  const db = getDb();
  for await (const item of iterator) {
    queue
      .add(async () => {
        if (signal?.abort) {
          return;
        }
        const bulkWriter = db.bulkWriter();

        if (item.data.event.approved === Flow.Addresses.Exchange[parseInt(item.data.baseParams.chainId, 10)]) {
          const ordersRef = getDb().collection('ordersV2') as CollRef<RawFirestoreOrderWithoutError>;

          /**
           * ERC721 approvals are required for asks
           *
           * this could be filtered by token id as well but might not be worth the additional index
           */
          const impactedOrdersQuery = ordersRef
            .where('metadata.source', '==', 'flow')
            .where('metadata.chainId', '==', item.data.baseParams.chainId)
            .where('order.isSellOrder', '==', true)
            .where('order.maker', '==', item.data.event.owner)
            .where('order.collection', '==', item.data.baseParams.address);

          /**
           * validate every impacted order
           */
          await validateOrders(impactedOrdersQuery, item.data, OrderEventKind.ApprovalChange, bulkWriter);
        }
        const contractEventMetadataUpdate: ContractEvent<unknown>['metadata'] = {
          ...item.data.metadata,
          processed: true
        };

        await bulkWriter.set(item.ref, { metadata: contractEventMetadataUpdate }, { merge: true });

        await bulkWriter.close();
      })
      .catch((err) => {
        logger.error('indexer', `Failed to handle ERC721 approval event ${err}`);
      });

    if (signal?.abort) {
      break;
    }

    if (queue.size > 500) {
      while (queue.size > 100) {
        await sleep(200);
      }
    }
  }

  await queue.onIdle();
}

export async function handleErc721ApprovalForAllEvents(signal?: { abort: boolean }) {
  const iterator = erc721ApprovalForAllEvents();

  const queue = new PQueue({ concurrency: 30 });
  const db = getDb();
  for await (const item of iterator) {
    queue
      .add(async () => {
        if (signal?.abort) {
          return;
        }

        const bulkWriter = db.bulkWriter();

        if (item.data.event.operator === Flow.Addresses.Exchange[parseInt(item.data.baseParams.chainId, 10)]) {
          const ordersRef = db.collection('ordersV2') as CollRef<RawFirestoreOrderWithoutError>;

          /**
           * ERC721 approvals are required for asks
           */
          const impactedOrdersQuery = ordersRef
            .where('metadata.source', '==', 'flow')
            .where('metadata.chainId', '==', item.data.baseParams.chainId)
            .where('order.isSellOrder', '==', true)
            .where('order.maker', '==', item.data.event.owner)
            .where('order.collection', '==', item.data.baseParams.address);

          /**
           * validate every impacted order
           */
          await validateOrders(impactedOrdersQuery, item.data, OrderEventKind.ApprovalChange, bulkWriter);
        }
        const contractEventMetadataUpdate: ContractEvent<unknown>['metadata'] = {
          ...item.data.metadata,
          processed: true
        };

        await bulkWriter.set(item.ref, { metadata: contractEventMetadataUpdate }, { merge: true });

        await bulkWriter.close();
      })
      .catch((err) => {
        logger.error('indexer', `Failed to handle ERC721 approval event ${err}`);
      });
    if (signal?.abort) {
      break;
    }

    if (queue.size > 500) {
      while (queue.size > 100) {
        await sleep(200);
      }
    }
  }
  await queue.onIdle();
}

export async function handleErc721TransferEvents(signal?: { abort: boolean }) {
  const iterator = erc721TransferEvents();

  const queue = new PQueue({ concurrency: 30 });
  const db = getDb();
  let count = 0;
  const increment = () => {
    count += 1;
    if (count % 500 === 0) {
      logger.log('indexer', `ERC721 transfers handled ${count} events`);
    }
  };

  for await (const item of iterator) {
    queue
      .add(async () => {
        if (signal?.abort) {
          return;
        }
        increment();

        const bulkWriter = db.bulkWriter();
        const ordersRef = db.collection('ordersV2') as CollRef<RawFirestoreOrderWithoutError>;

        /**
         * ERC721 transfers are required for asks
         *
         * this could be filtered by token id as well but might not be worth the additional index
         */
        const fromOrdersQuery = ordersRef
          .where('metadata.source', '==', 'flow')
          .where('metadata.chainId', '==', item.data.baseParams.chainId)
          .where('order.isSellOrder', '==', true)
          .where('order.maker', '==', item.data.event.from)
          .where('order.collection', '==', item.data.baseParams.address);

        const toOrdersQuery = ordersRef
          .where('metadata.source', '==', 'flow')
          .where('metadata.chainId', '==', item.data.baseParams.chainId)
          .where('order.isSellOrder', '==', true)
          .where('order.maker', '==', item.data.event.to)
          .where('order.collection', '==', item.data.baseParams.address);

        /**
         * validate every impacted order
         */
        await validateOrders(fromOrdersQuery, item.data, OrderEventKind.TokenOwnerUpdate, bulkWriter);
        await validateOrders(toOrdersQuery, item.data, OrderEventKind.TokenOwnerUpdate, bulkWriter);
        const contractEventMetadataUpdate: ContractEvent<unknown>['metadata'] = {
          ...item.data.metadata,
          processed: true
        };

        const id = `${item.data.baseParams.block}:${item.data.baseParams.blockHash}:${item.data.baseParams.logIndex}`;

        const transferEvent: NftTransferEvent = {
          metadata: {
            kind: NftEventKind.Transfer,
            processed: false,
            commitment: item.data.metadata.commitment,
            timestamp: Date.now(),
            chainId: item.data.baseParams.chainId,
            address: item.data.baseParams.address,
            tokenId: item.data.event.tokenId
          },
          data: {
            from: item.data.event.from,
            to: item.data.event.to,
            isMint: item.data.event.from === constants.AddressZero,
            blockNumber: item.data.baseParams.block,
            blockHash: item.data.baseParams.blockHash,
            blockTimestamp: item.data.baseParams.blockTimestamp,
            transactionHash: item.data.baseParams.txHash,
            transactionIndex: 0,
            logIndex: item.data.baseParams.logIndex,
            removed: item.data.metadata.reorged,
            topics: [],
            data: ''
          }
        };

        const tokenRef = getDb()
          .collection(firestoreConstants.COLLECTIONS_COLL)
          .doc(`${item.data.baseParams.chainId}:${item.data.baseParams.address}`)
          .collection(firestoreConstants.COLLECTION_NFTS_COLL)
          .doc(item.data.event.tokenId);

        const transferRef = tokenRef.collection('nftTransferEvents').doc(id);

        const promises = [];
        promises.push(bulkWriter.set(transferRef, transferEvent, { merge: true }));
        promises.push(bulkWriter.set(item.ref, { metadata: contractEventMetadataUpdate }, { merge: true }));

        await bulkWriter.close();
        await Promise.all(promises);
      })
      .catch((err) => {
        logger.error('indexer', `Failed to handle ERC721 transfer event ${err}`);
      });
    if (signal?.abort) {
      break;
    }

    if (queue.size > 1000) {
      while (queue.size > 200) {
        await sleep(200);
      }
    }
  }

  await queue.onIdle();
}
