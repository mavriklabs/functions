import { sleep } from '@infinityxyz/lib/utils';

import { SupportedCollectionsProvider } from '@/lib/collections/supported-collections-provider';

import * as Reservoir from '..';
import { DocRef, Firestore } from '../../../firestore/types';
import { SyncMetadata } from './types';

/**
 * a wrapper function to handle syncing multiple chains sales
 * at once
 *
 * note: if we are unable to handle the required throughput we can separate
 * these into separate processes to improve scalability
 */
export async function syncSaleEvents(
  db: Firestore,
  supportedCollections: SupportedCollectionsProvider,
  maxDuration: number | null,
  options?: { pollInterval?: number; delay?: number },
  stopAfterBackfill?: boolean
) {
  const start = Date.now();
  const stop = maxDuration != null ? start + maxDuration : null;
  const pollInterval = options?.pollInterval ?? 15 * 1000;

  const syncsRef = Reservoir.Sales.SyncMetadata.getSaleEventSyncsRef(db);
  const syncsQuery = syncsRef.where('metadata.isPaused', '==', false);

  const syncs = new Map<string, { isRunning: boolean; promise: Promise<void> }>();

  const stopSync = (id: string) => {
    const sync = syncs.get(id);
    if (sync?.isRunning) {
      sync.isRunning = false;
    }
  };

  const runSync = async (
    syncMetadata: { data: SyncMetadata; ref: DocRef<SyncMetadata> },
    checkAbort: () => { abort: boolean }
  ) => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const syncIterator = Reservoir.Sales.sync(db, syncMetadata, supportedCollections, checkAbort);
        for await (const pageDetails of syncIterator) {
          console.log(
            `Synced: ${syncMetadata.data.metadata.chainId}:${syncMetadata.data.metadata.type}  Saved ${pageDetails.numItemsInPage} Page ${pageDetails.pageNumber}`
          );
          if (stopAfterBackfill) {
            console.log(
              `Backfill completed for ${syncMetadata.data.metadata.chainId}:${syncMetadata.data.metadata.type}`
            );
            stopSync(syncMetadata.ref.id);
            return;
          }
          if (stop != null && Date.now() > stop) {
            stopSync(syncMetadata.ref.id);
            return;
          }
          if (pollInterval) {
            await sleep(pollInterval);
          }
        }
      } catch (err) {
        let log;
        if (err instanceof Error && err.message.includes('Abort')) {
          log = console.warn;
        } else {
          log = console.error;
        }
        log(
          `Failed to complete sync for ${syncMetadata.data.metadata.chainId}:${syncMetadata.data.metadata.type}:${
            syncMetadata.data.metadata.collection ?? ''
          }`,
          err
        );
      }

      const { abort } = checkAbort();
      if (abort) {
        return;
      }
    }
  };

  const startSync = (item: { data: SyncMetadata; ref: DocRef<SyncMetadata> }) => {
    const existingSync = syncs.get(item.ref.id);

    if (existingSync?.isRunning) {
      return;
    }

    const checkAbort = () => {
      const sync = syncs.get(item.ref.id);
      if (!sync?.isRunning) {
        return { abort: true };
      }

      return { abort: false };
    };

    syncs.set(item.ref.id, { isRunning: true, promise: runSync(item, checkAbort) });
  };

  const cancelSnapshot = syncsQuery.onSnapshot(
    (snapshot) => {
      const changes = snapshot.docChanges();
      console.log(`Received: ${changes.length} document changes`);

      for (const item of changes) {
        const data = item.doc.data();
        switch (item.type) {
          case 'added': {
            startSync({ data, ref: item.doc.ref });
            break;
          }
          case 'removed': {
            stopSync(item.doc.ref.id);
            break;
          }
          case 'modified': {
            if (data.metadata.isPaused) {
              stopSync(item.doc.ref.id);
            }
          }
        }
      }
    },
    (err) => {
      console.error(`On Snapshot error: ${err}`);
    }
  );

  const cancel = async () => {
    cancelSnapshot();
    const promises: Promise<void>[] = [];
    for (const item of syncs.values()) {
      item.isRunning = false;
      promises.push(item.promise);
    }
    await Promise.allSettled(promises);
  };

  await Promise.resolve(cancel);
}
