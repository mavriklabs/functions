import { getDb } from "@/firestore/db";
import { DocRef } from "@/firestore/types";
import { getUserRewards, saveUserRewards, UserRewardEvent } from "../referrals/sdk";


export const process = async (user: string, stream: AsyncGenerator<{ event: UserRewardEvent, ref: DocRef<UserRewardEvent> }>) => {
  const firestore = getDb();

  const userRewards = await getUserRewards(firestore, user);
  const batch = firestore.batch();
  const saves: (() => void)[] = [];
  for await (const { event, ref } of stream) {
    try {
      switch (event.kind) {
        case 'referral': {
          userRewards.referralPoints += event.totalPoints;
        }
        case 'listing': {
          // listing events contain the total points for the user
          userRewards.listingPoints = event.totalPoints;
        }
        case 'buy': {
          userRewards.buyPoints += event.totalPoints;
        }
        case 'airdrop': {
          userRewards.airdropPoints += event.totalPoints;
        }
      }

      // update totals
      userRewards.totalPoints = userRewards.referralPoints + userRewards.listingPoints + userRewards.buyPoints + userRewards.airdropPoints;

      saves.push(() => {
        batch.update(ref, { processed: true });
      })
    } catch (e) {
      console.error(e);
    }
  }

  for (const save of saves) {
    save();
  }
  saveUserRewards(firestore, userRewards, batch)
  await batch.commit();
}
