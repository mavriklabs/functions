import { ChainId, Erc20TokenMetadata } from "@infinityxyz/lib/types/core";
import JSBI from 'jsbi';


export const WETH_MAINNET: Erc20TokenMetadata = {
    chainId: ChainId.Mainnet,
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'.toLowerCase(),
    decimals: 18,
    symbol: 'WETH',
    name: 'Wrapped Ether'
}

export const USDC_MAINNET: Erc20TokenMetadata = {
    chainId: ChainId.Mainnet,
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'.toLowerCase(),
    decimals: 6,
    symbol: 'USDC',
    name: 'USD Coin'
}



export const Q96 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96));
export const Q192 = JSBI.exponentiate(Q96, JSBI.BigInt(2));

export const FACTORY_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984'.toLowerCase();
export const DEFAULT_POOL_FEE = 3000;