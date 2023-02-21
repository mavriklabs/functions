import { ChainId } from '@infinityxyz/lib/types/core';

import { getDb } from '@/firestore/db';

import { Reservoir } from '../lib';

export async function main() {
  await Reservoir.OrderEvents.addSyncs(getDb(), ChainId.Mainnet, ['bid'], undefined, Date.now());
}

void main();
