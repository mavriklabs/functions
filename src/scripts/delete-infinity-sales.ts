import { SaleSource } from '@infinityxyz/lib/types/core';
import { firestoreConstants } from '@infinityxyz/lib/utils';

import { BatchHandler } from '@/firestore/batch-handler';
import { getDb } from '@/firestore/db';

import { streamQueryWithRef } from '../firestore/stream-query';

async function deleteInfinitySales() {
  const db = getDb();

  const sales = db.collection(firestoreConstants.SALES_COLL);
  const infinitySales = sales.where('source', '==', SaleSource.Infinity);
  const stream = streamQueryWithRef(infinitySales, (_, ref) => [ref], { pageSize: 300 });

  const batch = new BatchHandler();
  for await (const { ref } of stream) {
    await batch.deleteAsync(ref as FirebaseFirestore.DocumentReference<any>);
  }

  await batch.flush();
}

void deleteInfinitySales();
