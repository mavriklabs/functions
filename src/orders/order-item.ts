import { FirestoreOrder, FirestoreOrderItem } from '@infinityxyz/lib/types/core/OBOrder';
import { firestoreConstants } from '@infinityxyz/lib/utils/constants';
import { streamQuery } from '../firestore';
import { OrderItemStartTimeConstraint } from './constraints/start-time-constraint';
import { OrderItem as IOrderItem } from './orders.types';
import { Constraint, constraints } from './constraints/constraint.types';

export class OrderItem implements IOrderItem {
  orderRef: FirebaseFirestore.DocumentReference<FirestoreOrder>;

  constructor(public readonly firestoreOrderItem: FirestoreOrderItem, public db: FirebaseFirestore.Firestore) {
    this.orderRef = this.db
      .collection(firestoreConstants.ORDERS_COLL)
      .doc(this.firestoreOrderItem.id) as FirebaseFirestore.DocumentReference<FirestoreOrder>;
  }

  public firestoreQueryOrderByConstraint: Constraint = OrderItemStartTimeConstraint;

  public get isAuction(): boolean {
    return this.firestoreOrderItem.startPriceEth !== this.firestoreOrderItem.endPriceEth;
  }

  public get constraintScore(): number {
    return 0;
  }

  public applyConstraints(): IOrderItem {
    let orderItem: IOrderItem | undefined = undefined;
    for (const Constraint of constraints) {
      orderItem = new Constraint(orderItem ?? this);
    }
    return orderItem ?? this;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public isMatch(_orderItem: FirestoreOrderItem): boolean {
    return true;
  }

  /**
   * getPossibleMatches queries for valid active orders that might be a match
   *
   * - due to firestore limitations and auctions, we cannot query for
   *  matches perfectly so the returned orders must be checked to see
   *  if they are a match
   */
  public getPossibleMatches(
    queryWithConstraints?: FirebaseFirestore.Query<FirestoreOrderItem>
  ): AsyncGenerator<FirestoreOrderItem> {
    if (!queryWithConstraints) {
      throw new Error('queryWithConstraints is required');
    }
    const orderByConstraint = new this.firestoreQueryOrderByConstraint(this);
    const { query, getStartAfter } = orderByConstraint.addOrderByToQuery(queryWithConstraints);

    return streamQuery<FirestoreOrderItem>(query, getStartAfter, {
      pageSize: 10
    });
  }

  getNumConstraints(): number {
    return 0;
  }
}
