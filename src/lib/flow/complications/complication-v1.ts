import { Contract, Signature } from 'ethers';
import { Interface, _TypedDataEncoder, verifyTypedData } from 'ethers/lib/utils';

import { defaultAbiCoder } from '@ethersproject/abi/lib/abi-coder';
import { Provider } from '@ethersproject/abstract-provider';
import { TypedDataSigner } from '@ethersproject/abstract-signer';
import { splitSignature } from '@ethersproject/bytes';
import { SignatureLike } from '@ethersproject/bytes';
import { Common } from '@reservoir0x/sdk';

import { Addresses, Types } from '..';
import ComplicationAbi from '../abis/Complication.json';
import { OrderParams } from '../order-params';
import { lc } from '../utils';
import { Complication } from './complication.interface';
import { ORDER_EIP712_TYPES } from './constants';

const CommonAddresses = Common.Addresses;

export class ComplicationV1 implements Complication {
  static supportsAddress(address: string): boolean {
    return Object.values(Addresses.Complication).includes(address);
  }

  public readonly supportsBulkSignatures = false;

  public readonly supportsContractSignatures = true;

  public get domain() {
    return {
      name: 'FlowComplication',
      version: '1',
      chainId: this.chainId,
      verifyingContract: this.address
    };
  }

  public readonly address: string;
  constructor(public readonly chainId: number) {
    this.address = Addresses.Complication[chainId] || '';
  }

  async sign(signer: TypedDataSigner, params: Types.InternalOrder): Promise<string> {
    const { types, value, domain } = this.getSignatureData(params);
    const sig = splitSignature(await signer._signTypedData(domain, types, value));
    const encodedSig = this._getEncodedSig(sig);
    return encodedSig;
  }

  async verifySignature(encodedSig: string, params: Types.InternalOrder, provider?: Provider): Promise<void> {
    const { types, value, domain } = this.getSignatureData(params);
    try {
      const decodedSig = this._getDecodedSig(encodedSig);

      const signer = verifyTypedData(domain, types, value, decodedSig);

      if (lc(signer) !== lc(params.signer)) {
        throw new Error('Invalid signature');
      }
    } catch (err) {
      if (!provider) {
        throw new Error('Invalid signature');
      }

      /**
       * check if the signature is a contract signature
       */
      const eip712Hash = _TypedDataEncoder.hash(domain, types, value);

      const iface = new Interface(['function isValidSignature(bytes32 digest, bytes signature) view returns (bytes4)']);

      const result = await new Contract(params.signer, iface, provider).isValidSignature(eip712Hash, encodedSig);
      if (result !== iface.getSighash('isValidSignature')) {
        throw new Error('Invalid signature');
      }
    }
  }

  getSignatureData(params: Types.InternalOrder): Types.SignatureData {
    return {
      signatureKind: 'eip712',
      domain: this.domain,
      types: ORDER_EIP712_TYPES,
      value: params,
      primaryType: _TypedDataEncoder.getPrimaryType(ORDER_EIP712_TYPES)
    };
  }

  joinSignature(sig: Signature | { v: number; r: string; s: string }): string {
    return this._getEncodedSig(sig);
  }

  async checkFillability(provider: Provider, order: OrderParams): Promise<void> {
    const complication = new Contract(this.address, ComplicationAbi, provider);

    if (order.currency !== CommonAddresses.Eth[this.chainId]) {
      const isCurrencyValid = await complication.isValidCurrency(order.currency);
      if (!isCurrencyValid) {
        throw new Error('not-fillable');
      }
    }
  }

  checkBaseValid() {
    if (!this.address) {
      throw new Error('Invalid chainId for complication');
    }
  }

  protected _getEncodedSig(signature: Signature | { v: number; r: string; s: string }): string {
    const encodedSig = defaultAbiCoder.encode(['bytes32', 'bytes32', 'uint8'], [signature.r, signature.s, signature.v]);

    return encodedSig;
  }

  protected _getDecodedSig(encodedSig: string): SignatureLike {
    const [r, s, v] = defaultAbiCoder.decode(['bytes32', 'bytes32', 'uint8'], encodedSig);

    return { r, s, v };
  }
}
