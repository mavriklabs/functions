import { BigNumber, BigNumberish, Contract } from 'ethers';

import { Log } from '@ethersproject/abstract-provider';
import { CallTrace, CallType } from '@georgeroman/evm-tx-simulator/dist/types';
import { ChainId, ChainNFTs } from '@infinityxyz/lib/types/core';

import { logger } from '@/lib/logger';

import { AbstractEvent } from '../event.abstract';
import { BaseParams, ContractEventKind } from '../types';
import { FlowFulfillOrderMethods } from './utils';

export interface MatchOrderFulfilledEventData {
  sellOrderHash: string;
  buyOrderHash: string;
  seller: string;
  buyer: string;
  complication: string;
  currency: string;
  amount: string;
  nfts: ChainNFTs[];
  sellOrderNonce: string;
  buyOrderNonce: string;
}

export class MatchOrderFulfilledEvent extends AbstractEvent<MatchOrderFulfilledEventData> {
  protected _topics: (string | string[])[];
  protected _topic: string | string[];
  protected _numTopics: number;

  protected _eventKind = ContractEventKind.FlowExchangeMatchOrderFulfilled;

  constructor(chainId: ChainId, protected _contract: Contract, address: string, db: FirebaseFirestore.Firestore) {
    super(chainId, address, _contract.interface, db);
    const event = _contract.filters.MatchOrderFulfilled();
    this._topics = event.topics ?? [];
    this._topic = this._topics[0];
    this._numTopics = 4;
  }

  async transformEvent(event: { log: Log; baseParams: BaseParams }): Promise<MatchOrderFulfilledEventData> {
    const parsedLog = this._iface.parseLog(event.log);
    const sellOrderHash = parsedLog.args.sellOrderHash.toLowerCase();
    const buyOrderHash = parsedLog.args.buyOrderHash.toLowerCase();
    const seller = parsedLog.args.seller.toLowerCase();
    const buyer = parsedLog.args.buyer.toLowerCase();
    const complication = parsedLog.args.complication.toLowerCase();
    const currency = parsedLog.args.currency.toLowerCase();
    const amount = BigNumber.from(parsedLog.args.amount).toString();
    const nftsPreNormalization = parsedLog.args.nfts as {
      collection: string;
      tokens: {
        tokenId: BigNumberish;
        numTokens: BigNumberish;
      }[];
    }[];

    const nfts: ChainNFTs[] = nftsPreNormalization.map((nft) => {
      return {
        collection: nft.collection.toLowerCase(),
        tokens: nft.tokens.map((token) => ({
          tokenId: BigNumber.from(token.tokenId).toString(),
          numTokens: BigNumber.from(token.numTokens).toNumber()
        }))
      };
    });

    const { nonce: sellOrderNonce } = await this.getOrderNonceFromTrace(sellOrderHash, event.baseParams);
    const { nonce: buyOrderNonce } = await this.getOrderNonceFromTrace(buyOrderHash, event.baseParams);

    if (!sellOrderNonce) {
      throw new Error(`Failed to find nonce for order ${sellOrderHash}`);
    } else if (!buyOrderNonce) {
      throw new Error(`Failed to find nonce for order ${buyOrderHash}`);
    }
    return {
      sellOrderHash,
      buyOrderHash,
      seller,
      buyer,
      complication,
      currency,
      amount,
      nfts,
      sellOrderNonce,
      buyOrderNonce
    };
  }

  async getOrderNonceFromTrace(orderHash: string, params: { txHash: string }): Promise<{ nonce: string | null }> {
    const txTrace = await this.getCallTrace(params);

    const searchValue = {
      to: this._contract.address,
      type: 'CALL' as CallType,
      sigHashes: Object.values(FlowFulfillOrderMethods).map((item) => item.methodId)
    };

    const traces = searchForCalls(txTrace, searchValue);

    for (const trace of traces) {
      if (trace) {
        const input = trace?.input;
        const method = Object.values(FlowFulfillOrderMethods).find((method) => {
          return input.startsWith(method.methodId);
        });

        if (method) {
          try {
            const result = method.decodeInput(input, this._contract.interface, this._chainId);

            const order = result.find((item) => {
              return item.hash() === orderHash;
            });

            if (order) {
              return { nonce: order.nonce };
            }
          } catch (err) {
            logger.error('match-order-fulfilled', `Failed to decode input for ${this._eventKind} ${err}`);
          }
        }
      }
    }
    return { nonce: null };
  }
}

export const searchForCalls = (
  trace: CallTrace,
  options: { to?: string; type?: CallType; sigHashes?: string[] }
): CallTrace[] => {
  const matches: CallTrace[] = [];
  const helper = (trace: CallTrace) => {
    let match = true;
    if (options.to && trace.to !== options.to) {
      match = false;
    }
    if (options.type && trace.type !== options.type) {
      match = false;
    }
    if (options.sigHashes && !options.sigHashes.includes(trace.input.slice(0, 10))) {
      match = false;
    }
    if (trace.error) {
      match = false;
    }

    if (match) {
      matches.push(trace);
    }

    if (!trace.error) {
      for (const call of trace.calls ?? []) {
        helper(call);
      }
    }
  };

  helper(trace);

  return matches;
};
