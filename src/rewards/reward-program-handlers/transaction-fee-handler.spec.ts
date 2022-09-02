import { RewardProgram, RewardSaleEvent, RewardType } from '@infinityxyz/lib/types/core';
import { TradingRewardDto } from '@infinityxyz/lib/types/dto/rewards';
import { RewardPhase } from '../reward-phase';
import { getMockRewardPhaseConfig } from '../reward-phase.spec';
import { TransactionFeeHandler } from './transaction-fee-handler';

class MockTransactionFeeHandler extends TransactionFeeHandler {
  getSaleReward(
    sale: RewardSaleEvent,
    tradingReward: TradingRewardDto
  ): { total: number; buyerReward: number; sellerReward: number } {
    return this._getSaleReward(sale, tradingReward);
  }

  splitSale(sale: RewardSaleEvent, reward: number, phaseSupplyRemaining: number) {
    return this._splitSale(sale, reward, phaseSupplyRemaining);
  }

  getBuyerAndSellerEvents(sale: RewardSaleEvent, phase: RewardPhase, buyerReward: number, sellerReward: number) {
    return this._getBuyerAndSellerEvents(sale, phase, buyerReward, sellerReward);
  }

  onSale(sale: RewardSaleEvent, phase: RewardPhase) {
    return this._onSale(sale, phase);
  }
}

describe('TransactionFeeHandler', () => {
  it('distributes protocol fees according to buyer and seller portions', () => {
    const sale = {
      protocolFee: 0.0000000000001,
      ethPrice: 2000
    } as any as RewardSaleEvent;

    const tradingReward: TradingRewardDto = {
      rewardRateNumerator: 2,
      rewardRateDenominator: 1,
      buyerPortion: 0.2,
      sellerPortion: 0.8,
      maxReward: 100,
      rewardType: RewardType.ETH,
      rewardSupply: 1000,
      rewardSupplyUsed: 100
    };

    const handler = new MockTransactionFeeHandler();

    const { total, buyerReward, sellerReward } = handler.getSaleReward(sale, tradingReward);

    expect(buyerReward).toBeCloseTo(total * tradingReward.buyerPortion);
    expect(sellerReward).toBeCloseTo(total * tradingReward.sellerPortion);

    expect(total).toBeCloseTo(
      (sale.protocolFee * sale.ethPrice * tradingReward.rewardRateNumerator) / tradingReward.rewardRateDenominator
    );
  });

  it('splits the price and protocol fees', () => {
    const handler = new MockTransactionFeeHandler();
    const sale = {
      protocolFee: 1,
      price: 2
    } as any as RewardSaleEvent;

    const reward = 50;
    const phaseSupplyRemaining = 25;

    const split = handler.splitSale(sale, reward, phaseSupplyRemaining);

    expect(split.current.price).toBeCloseTo(sale.price / 2);
    expect(split.current.protocolFee).toBeCloseTo(sale.protocolFee / 2);

    expect(split.remainder.price).toBeCloseTo(sale.price / 2);
    expect(split.remainder.protocolFee).toBeCloseTo(sale.protocolFee / 2);
  });

  it('sets isSplit in the resulting sale events when splitSale is called', () => {
    const handler = new MockTransactionFeeHandler();
    const sale = {
      protocolFee: 1,
      price: 2
    } as any as RewardSaleEvent;

    const reward = 50;
    const phaseSupplyRemaining = 25;

    const split = handler.splitSale(sale, reward, phaseSupplyRemaining);

    expect(split.current.isSplit).toBe(true);
    expect(split.remainder.isSplit).toBe(true);
  });

  it('gives both the buyer and seller the total volume', () => {
    const handler = new MockTransactionFeeHandler();
    const sale = {
      protocolFee: 1,
      price: 2,
      ethPrice: 2000
    } as any as RewardSaleEvent;
    const phaseConfig = getMockRewardPhaseConfig(100, 0);
    const phase = new RewardPhase(phaseConfig);
    const tradingRewards = phase.getRewardProgram(RewardProgram.TradingFee);
    if (!tradingRewards || typeof tradingRewards === 'boolean') {
      throw new Error('Invalid rewards program');
    }

    const reward = handler.getSaleReward(sale, tradingRewards);

    const { buyer, seller } = handler.getBuyerAndSellerEvents(sale, phase, reward.buyerReward, reward.sellerReward);

    expect(buyer.volumeEth).toBeCloseTo(sale.price);
    expect(seller.volumeEth).toBeCloseTo(sale.price);

    expect(buyer.reward).toBe(reward.buyerReward);
    expect(seller.reward).toBe(reward.sellerReward);
  });

  it('updates the phase when the rewards are distributed', () => {
    const handler = new MockTransactionFeeHandler();
    const sale = {
      protocolFee: 1,
      price: 2,
      ethPrice: 2000
    } as any as RewardSaleEvent;
    const phaseConfig = getMockRewardPhaseConfig(2000, 0);
    const phase = new RewardPhase(phaseConfig);
    const tradingRewardsBefore = JSON.parse(
      JSON.stringify(phase.getRewardProgram(RewardProgram.TradingFee))
    ) as TradingRewardDto;
    if (!tradingRewardsBefore || typeof tradingRewardsBefore === 'boolean') {
      throw new Error('Invalid rewards program');
    }

    const rewards = handler.getSaleReward(sale, tradingRewardsBefore);
    const result = handler.onSale(sale, phase);

    const tradingRewardsAfter = result.phase.getRewardProgram(RewardProgram.TradingFee);

    if (!tradingRewardsAfter || typeof tradingRewardsAfter === 'boolean') {
      throw new Error('Invalid rewards program');
    }

    expect(result.split).toBeUndefined();
    expect(tradingRewardsAfter.rewardSupplyUsed).toBe(tradingRewardsBefore.rewardSupplyUsed + rewards.total);
    expect(result.applicable).toBe(true);
  });

  it('splits rewards if the rewards are greater than the supply available', () => {
    const handler = new MockTransactionFeeHandler();
    const sale = {
      protocolFee: 1,
      price: 2,
      ethPrice: 2000
    } as any as RewardSaleEvent;
    const phaseConfig = getMockRewardPhaseConfig(1999, 0);
    const phase = new RewardPhase(phaseConfig);
    const tradingRewardsBefore = JSON.parse(
      JSON.stringify(phase.getRewardProgram(RewardProgram.TradingFee))
    ) as TradingRewardDto;
    if (!tradingRewardsBefore || typeof tradingRewardsBefore === 'boolean') {
      throw new Error('Invalid rewards program');
    }

    const result = handler.onSale(sale, phase);

    const tradingRewardsAfter = result.phase.getRewardProgram(RewardProgram.TradingFee);

    if (!tradingRewardsAfter || typeof tradingRewardsAfter === 'boolean') {
      throw new Error('Invalid rewards program');
    }

    expect(result.split).toBeDefined();
    expect(tradingRewardsAfter.rewardSupplyUsed).toBe(tradingRewardsBefore.rewardSupplyUsed);
    expect(result.applicable).toBe(true);
  });
});
