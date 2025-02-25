import { BigNumber, Contract } from 'ethers';

import { Log } from '@ethersproject/abstract-provider';
import { ChainId } from '@infinityxyz/lib/types/core';

import { AbstractEvent } from '../event.abstract';
import { BaseParams, ContractEventKind } from '../types';

export interface Erc20ApprovalEventData {
  owner: string;
  spender: string;
  value: string;
}

export class Erc20ApprovalEvent extends AbstractEvent<Erc20ApprovalEventData> {
  protected _topics: (string | string[])[];
  protected _topic: string | string[];
  protected _numTopics: number;
  protected _eventKind = ContractEventKind.Erc20Approval;

  constructor(chainId: ChainId, contract: Contract, address: string, db: FirebaseFirestore.Firestore) {
    super(chainId, address, contract.interface, db);
    const event = contract.filters.Approval();
    this._topics = event.topics ?? [];
    this._topic = this._topics[0];
    this._numTopics = 3;
  }

  transformEvent(event: { log: Log; baseParams: BaseParams }): Erc20ApprovalEventData {
    const parsedLog = this._iface.parseLog(event.log);
    const owner = parsedLog.args.owner.toLowerCase();
    const spender = parsedLog.args.spender.toLowerCase();
    const value = BigNumber.from(parsedLog.args.value).toString();

    return {
      owner,
      spender,
      value
    };
  }
}
