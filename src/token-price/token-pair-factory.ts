import { ChainId } from '@infinityxyz/lib/types/core/ChainId';
import { Env, getTokenAddress } from '@infinityxyz/lib/utils';
import { Token } from '@uniswap/sdk-core';
import { ethers } from 'ethers';
import { CachedTokenPair } from './cached-token-pair';
import { TokenPair } from './token-pair';
import { TokenPairEstimate } from './token-pair-estimate';
import { TokenPair as ITokenPair } from './token-pair.interface';

export class TokenPairFactory {
  constructor(
    protected _db: FirebaseFirestore.Firestore,
    protected _mainnetProvider: ethers.providers.JsonRpcProvider
  ) {}

  static readonly EST_DOLLARS_PER_NFT = 0.07;

  public create(
    tokenAddress: string,
    tokenChainId: ChainId,
    decimals: number,
    symbol: string,
    name: string
  ): ITokenPair {
    const goerliToken = getTokenAddress(ChainId.Goerli);
    const mainnetTokenDev = getTokenAddress(ChainId.Mainnet, Env.Dev);
    const chainIdInt = parseInt(tokenChainId, 10);
    const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'.toLowerCase();
    const wethToken = new Token(parseInt(ChainId.Mainnet, 10), WETH, 18, 'WETH', 'Wrapped Ether');
    switch (tokenAddress) {
      case goerliToken:
      case mainnetTokenDev: {
        const token0 = new Token(chainIdInt, tokenAddress, decimals, symbol, name);
        const tokenPair = new TokenPairEstimate(
          this._db,
          token0,
          wethToken,
          this._mainnetProvider,
          TokenPairFactory.EST_DOLLARS_PER_NFT
        );
        const cachedTokenPair = new CachedTokenPair(this._db, tokenPair);
        return cachedTokenPair;
      }
      default: {
        if (tokenChainId !== ChainId.Mainnet) {
          throw new Error(`Token not yet supported ${tokenChainId} ${tokenAddress}`);
        }
        const token0 = new Token(chainIdInt, tokenAddress, decimals, symbol, name);
        const tokenPair = new TokenPair(token0, wethToken, this._mainnetProvider);
        const cachedTokenPair = new CachedTokenPair(this._db, tokenPair);
        return cachedTokenPair;
      }
    }
  }
}
