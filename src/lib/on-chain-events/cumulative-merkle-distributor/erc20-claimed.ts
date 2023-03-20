import { BigNumber, Contract } from 'ethers';

import { Log } from '@ethersproject/abstract-provider';
import { ChainId } from '@infinityxyz/lib/types/core';

import { AbstractEvent } from '../event.abstract';
import { BaseParams, ContractEventKind } from '../types';

export interface Erc20ClaimedEventData {
  token: string;
  user: string;
  amount: string;
}

export class Erc20Claimed extends AbstractEvent<Erc20ClaimedEventData> {
  protected _topics: (string | string[])[];
  protected _topic: string | string[];
  protected _numTopics: number;
  protected _eventKind = ContractEventKind.CumulativeMerkleDistributorErc20Claimed;

  constructor(chainId: ChainId, contract: Contract, address: string, db: FirebaseFirestore.Firestore) {
    super(chainId, address, contract.interface, db);
    const event = contract.filters.Erc20Claimed();
    this._topics = event.topics ?? [];
    this._topic = this._topics[0];
    this._numTopics = 1;
  }

  transformEvent(event: { log: Log; baseParams: BaseParams }): Erc20ClaimedEventData {
    const parsedLog = this._iface.parseLog(event.log);
    const user = parsedLog.args.user.toLowerCase();
    const token = parsedLog.args.token.toLowerCase();
    const amount = BigNumber.from(parsedLog.args.amount).toString();
    return { user, amount, token };
  }
}
