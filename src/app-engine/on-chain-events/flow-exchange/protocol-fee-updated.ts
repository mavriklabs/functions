import { BigNumber, Contract } from 'ethers';

import { Log } from '@ethersproject/abstract-provider';
import { ChainId } from '@infinityxyz/lib/types/core';

import { AbstractEvent } from '../event.abstract';
import { BaseParams, ContractEventKind } from '../types';

export interface ProtocolFeeUpdatedEventData {
  protocolFee: string;
}

export class ProtocolFeeUpdatedEvent extends AbstractEvent<ProtocolFeeUpdatedEventData> {
  protected _topics: (string | string[])[];
  protected _topic: string | string[];
  protected _numTopics: number;

  protected _eventKind: ContractEventKind.FlowExchangeProtocolFeeUpdated;

  constructor(chainId: ChainId, contract: Contract, addresses: string[], db: FirebaseFirestore.Firestore) {
    super(chainId, addresses, contract.interface, db);
    const event = contract.filters.ProtocolFeeUpdated();
    this._topics = event.topics ?? [];
    this._topic = this._topics[0];
    this._numTopics = this._topics.length;
  }

  protected transformEvent(event: { log: Log; baseParams: BaseParams }): ProtocolFeeUpdatedEventData {
    const parsedLog = this._iface.parseLog(event.log);
    const protocolFee = BigNumber.from(parsedLog.args.protocolFee).toString();

    return { protocolFee };
  }
}
