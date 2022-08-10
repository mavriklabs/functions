import { ChainId } from '@infinityxyz/lib/types/core/ChainId';
import {
  CurationLedgerSale,
  CurationVotesAdded,
  CurationVotesRemoved,
  CurationBlockRewardsDoc,
  CurationLedgerEventType,
  CurationLedgerEvent,
  CurationBlockRewards,
  CurationBlockUser,
  CurationBlockUsers
} from '@infinityxyz/lib/types/core/curation-ledger';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import { formatEther } from 'ethers/lib/utils';
import { calcPercentChange, calculateStatsBigInt } from '../aggregate-sales-stats/utils';
import { streamQueryWithRef } from '../firestore/stream-query';
import { formatEth, round } from '../utils';

interface BlockMetadata {
  /**
   * inclusive
   */
  blockStart: number;
  collectionAddress: string;
  chainId: ChainId;
}

/**
 * a curation block is a collection of curation events within an arbitrary
 * range of ethereum blocks or timestamps
 *
 * its purpose is to calculate rewards for curators over this arbitrary range
 */
export class CurationBlock {
  private _sales: CurationLedgerSale[] = [];
  private _votes: CurationVotesAdded[] = [];
  private _votesRemoved: CurationVotesRemoved[] = [];

  static async getBlockUsers(
    blockRewardsRef: FirebaseFirestore.DocumentReference<CurationBlockRewardsDoc>
  ): Promise<CurationBlockUsers> {
    const users: CurationBlockUsers = {};
    const usersQuery = blockRewardsRef.collection(
      firestoreConstants.CURATION_BLOCK_USER_REWARDS_COLL
    ) as FirebaseFirestore.CollectionReference<CurationBlockUser>;
    const usersStream = streamQueryWithRef(usersQuery, (item, ref) => [ref], { pageSize: 300 });
    for await (const { data: user } of usersStream) {
      if (user.userAddress) {
        users[user.userAddress] = user;
      }
    }
    return users;
  }

  constructor(public readonly metadata: BlockMetadata) {}

  public addEvent(event: CurationLedgerEventType) {
    switch (event.discriminator) {
      case CurationLedgerEvent.Sale:
        this._sales.push(event as CurationLedgerSale);
        break;
      case CurationLedgerEvent.VotesAdded:
        this._votes.push(event as CurationVotesAdded);
        break;
      case CurationLedgerEvent.VotesRemoved:
        this._votesRemoved.push(event as CurationVotesRemoved);
        break;
    }
  }

  get feesGeneratedWei() {
    const sum = calculateStatsBigInt(this._sales, (sale) => BigInt(sale.protocolFeeWei)).sum;
    return sum.toString();
  }

  get numVotesAdded(): number {
    return this._votes.reduce((acc, vote) => vote.votes + acc, 0);
  }

  get numVotesRemoved(): number {
    return this._votesRemoved.reduce((acc, vote) => vote.votes + acc, 0);
  }

  public getBlockRewards(prevBlockRewards: CurationBlockRewards): {
    blockRewards: CurationBlockRewards;
    usersAdded: CurationBlockUsers;
    usersRemoved: CurationBlockUsers;
  } {
    const prevUsers = prevBlockRewards.users;
    const {
      updatedUsers: updatedUsersAfterRemovals,
      usersRemoved,
      numCuratorVotesRemoved
    } = this.applyVoteRemovals(prevUsers, this._votesRemoved);

    const {
      updatedUsers: updatedUsersAfterAdditions,
      newUsers,
      numCuratorVotesAdded
    } = this.applyVoteAdditions(updatedUsersAfterRemovals, this._votes);

    const voteStats = calculateStatsBigInt(Object.values(updatedUsersAfterAdditions), (user) => BigInt(user.votes));
    const blockProtocolFeesAccruedWei = BigInt(this.feesGeneratedWei);
    const totalProtocolFeesAccruedWei =
      blockProtocolFeesAccruedWei + BigInt(prevBlockRewards.totalProtocolFeesAccruedWei);
    const numCuratorVotes = parseInt(voteStats.sum.toString(), 10);
    const numCurators = voteStats.numItems;

    const updatedUsersAfterStatsUpdate = this.updateVoteStats(updatedUsersAfterAdditions, numCurators, numCuratorVotes);

    const blockRewardsBeforeDistribution: CurationBlockRewards = {
      users: updatedUsersAfterStatsUpdate,
      collectionAddress: this.metadata.collectionAddress,
      chainId: this.metadata.chainId,
      numCurators,
      numCuratorVotes: numCuratorVotes,
      numCuratorsAdded: Object.keys(newUsers).length,
      numCuratorsRemoved: Object.keys(usersRemoved).length,
      numCuratorVotesRemoved,
      numCuratorVotesAdded,
      numCuratorsPercentChange: calcPercentChange(prevBlockRewards.numCurators, numCurators),
      numCuratorVotesPercentChange: calcPercentChange(prevBlockRewards.numCuratorVotes, numCuratorVotes),
      totalProtocolFeesAccruedWei: totalProtocolFeesAccruedWei.toString(),
      totalProtocolFeesAccruedEth: parseFloat(formatEther(totalProtocolFeesAccruedWei.toString())),
      blockProtocolFeesAccruedWei: blockProtocolFeesAccruedWei.toString(),
      blockProtocolFeesAccruedEth: parseFloat(formatEther(blockProtocolFeesAccruedWei.toString())),
      arbitrageProtocolFeesAccruedWei: prevBlockRewards.arbitrageProtocolFeesAccruedWei,
      arbitrageProtocolFeesAccruedEth: prevBlockRewards.arbitrageProtocolFeesAccruedEth,
      timestamp: this.metadata.blockStart,
      isAggregated: false
    };

    const blockRewards = this.distributeRewards(blockRewardsBeforeDistribution);

    return { blockRewards, usersRemoved, usersAdded: newUsers };
  }

  protected applyVoteRemovals(
    users: CurationBlockUsers,
    votesRemoved: CurationVotesRemoved[]
  ): { updatedUsers: CurationBlockUsers; usersRemoved: CurationBlockUsers; numCuratorVotesRemoved: number } {
    const currentUsers: CurationBlockUsers = JSON.parse(JSON.stringify(users));
    let numCuratorVotesRemoved = 0;
    for (const voteRemoved of votesRemoved) {
      const existingUser = currentUsers[voteRemoved.userAddress];
      if (!existingUser) {
        console.error(`User ${voteRemoved.userAddress} not found in history. Cannot remove votes`);
      } else {
        const userVotesRemaining = Math.max(existingUser.votes - voteRemoved.votes, 0);
        existingUser.votes = userVotesRemaining;
        numCuratorVotesRemoved += voteRemoved.votes;
      }
    }

    const usersRemoved = {} as CurationBlockUsers;
    for (const [address, user] of Object.entries(currentUsers)) {
      if (user.votes <= 0) {
        user.votes = 0;
        delete currentUsers[address];
        usersRemoved[address] = user;
      }
    }

    return { updatedUsers: currentUsers, usersRemoved, numCuratorVotesRemoved };
  }

  protected updateVoteStats(
    users: CurationBlockUsers,
    numCurators: number,
    numCuratorVotes: number
  ): CurationBlockUsers {
    const updatedUsers: CurationBlockUsers = JSON.parse(JSON.stringify(users));
    for (const [, user] of Object.entries(updatedUsers)) {
      user.numCurators = numCurators;
      user.numCuratorVotes = numCuratorVotes;
      user.curatorShare = round((user.votes / numCuratorVotes) * 100);
    }
    return updatedUsers;
  }

  protected applyVoteAdditions(
    users: CurationBlockUsers,
    votesAdded: CurationVotesAdded[]
  ): { updatedUsers: CurationBlockUsers; newUsers: CurationBlockUsers; numCuratorVotesAdded: number } {
    const currentUsers: CurationBlockUsers = JSON.parse(JSON.stringify(users));
    const newUsers = {} as CurationBlockUsers;
    let numCuratorVotesAdded = 0;
    for (const voteAdded of votesAdded) {
      const existingUser = currentUsers[voteAdded.userAddress];
      numCuratorVotesAdded += voteAdded.votes;
      if (existingUser) {
        const updatedVotes = existingUser.votes + voteAdded.votes;
        existingUser.votes = updatedVotes;
        existingUser.lastVotedAt = this.metadata.blockStart;
      } else {
        const newUser: CurationBlockUser = {
          userAddress: voteAdded.userAddress,
          votes: voteAdded.votes,
          totalProtocolFeesAccruedWei: '0',
          blockProtocolFeesAccruedWei: '0',
          firstVotedAt: this.metadata.blockStart,
          lastVotedAt: this.metadata.blockStart,
          collectionAddress: this.metadata.collectionAddress,
          chainId: this.metadata.chainId,
          updatedAt: Date.now(),
          totalProtocolFeesAccruedEth: 0,
          blockProtocolFeesAccruedEth: 0,
          curatorShare: 0,
          numCurators: 0,
          numCuratorVotes: 0
        };
        currentUsers[newUser.userAddress] = newUser;
        newUsers[newUser.userAddress] = { ...newUser };
      }
    }

    return { updatedUsers: currentUsers, newUsers, numCuratorVotesAdded };
  }

  protected distributeRewards(_rewards: CurationBlockRewards): CurationBlockRewards {
    const rewards: CurationBlockRewards = JSON.parse(JSON.stringify(_rewards));
    const totalVotes = rewards.numCuratorVotes;
    const fees = BigInt(rewards.blockProtocolFeesAccruedWei) + BigInt(rewards.arbitrageProtocolFeesAccruedWei);
    let feesDistributed = BigInt(0);
    for (const user of Object.values(rewards.users)) {
      const userVotes = user.votes;
      const userFees = (BigInt(userVotes) * BigInt(fees)) / BigInt(totalVotes);
      user.blockProtocolFeesAccruedWei = userFees.toString();
      feesDistributed += userFees;
      user.totalProtocolFeesAccruedWei = (BigInt(user.totalProtocolFeesAccruedWei) + userFees).toString();
      user.updatedAt = Date.now();
      user.totalProtocolFeesAccruedEth = formatEth(user.totalProtocolFeesAccruedWei);
      user.blockProtocolFeesAccruedEth = formatEth(user.blockProtocolFeesAccruedWei);
    }
    const feesRemaining = fees - feesDistributed;
    if (feesDistributed > fees) {
      throw new Error(`Fees distributed (${feesDistributed}) > fees (${fees})`);
    }

    return {
      ...rewards,
      arbitrageProtocolFeesAccruedWei: feesRemaining.toString(),
      arbitrageProtocolFeesAccruedEth: parseFloat(formatEther(feesRemaining.toString()))
    };
  }
}
