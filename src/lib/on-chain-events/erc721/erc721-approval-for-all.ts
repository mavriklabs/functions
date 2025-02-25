import { Contract } from 'ethers';

import { Log } from '@ethersproject/abstract-provider';
import { ChainId } from '@infinityxyz/lib/types/core';

import { AbstractEvent } from '../event.abstract';
import { BaseParams, ContractEventKind } from '../types';

export interface Erc721ApprovalForAllEventData {
  owner: string;
  operator: string;
  approved: boolean;
}

export class Erc721ApprovalForAllEvent extends AbstractEvent<Erc721ApprovalForAllEventData> {
  protected _topics: (string | string[])[];
  protected _topic: string | string[];
  protected _numTopics: number;
  protected _eventKind = ContractEventKind.Erc721ApprovalForAll;

  constructor(chainId: ChainId, contract: Contract, address: string, db: FirebaseFirestore.Firestore) {
    super(chainId, address, contract.interface, db);
    const event = contract.filters.ApprovalForAll();
    this._topics = event.topics ?? [];
    this._topic = this._topics[0];
    this._numTopics = 3;
  }

  transformEvent(event: { log: Log; baseParams: BaseParams }): Erc721ApprovalForAllEventData {
    const parsedLog = this._iface.parseLog(event.log);
    const owner = parsedLog.args.owner.toLowerCase();
    const operator = parsedLog.args.operator.toLowerCase();
    const approved = parsedLog.args.approved as boolean;

    return {
      owner,
      operator,
      approved
    };
  }
}
