import { OrderDirection } from '@infinityxyz/lib/types/core';
import { FirestoreOrder, FirestoreOrderItem } from '@infinityxyz/lib/types/core/OBOrder';
import { firestoreConstants } from '@infinityxyz/lib/utils/constants';
import { OrderItem as IOrderItem, OrderItem, ValidationResponse } from '../orders.types';

export abstract class OrderItemConstraint implements IOrderItem {
  public component: OrderItem;

  static POSSIBLE_MATCHES_DEFAULT_PAGE_SIZE = 500;

  constructor(orderItem: OrderItem) {
    this.component = orderItem;
  }
  get maxNumItemsContribution(): number {
    return this.component.maxNumItemsContribution;
  }

  get id() {
    return this.component.id;
  }

  get orderRef(): FirebaseFirestore.DocumentReference<FirestoreOrder> {
    return this.component.orderRef;
  }

  get isAuction(): boolean {
    return this.component.isAuction;
  }

  get db(): FirebaseFirestore.Firestore {
    return this.component.db;
  }

  get firestoreOrderItem(): FirestoreOrderItem {
    return this.component.firestoreOrderItem;
  }

  get firestoreQueryOrderByConstraint() {
    return this.component.firestoreQueryOrderByConstraint;
  }

  /**
   * provides an estimate of how restrictive the order is
   */
  get constraintScore(): number {
    return this.score + this.component.constraintScore;
  }

  getNumConstraints(): number {
    return this.component.getNumConstraints() + 1;
  }

  isMatch(orderItem: FirestoreOrderItem): ValidationResponse {
    const response = this.isConstraintSatisfied(orderItem);
    const componentResponse = this.component.isMatch(orderItem);
    const isValid = response.isValid && componentResponse.isValid;

    if (isValid) {
      return {
        isValid
      };
    }

    const responseReasons = response.isValid ? [] : response.reasons;
    const componentResponseReasons = componentResponse.isValid ? [] : componentResponse.reasons;
    return {
      isValid,
      reasons: [...responseReasons, ...componentResponseReasons]
    };
  }

  getPossibleMatches(
    query?: FirebaseFirestore.Query<FirestoreOrderItem>,
    pageSize = OrderItemConstraint.POSSIBLE_MATCHES_DEFAULT_PAGE_SIZE
  ): AsyncGenerator<FirestoreOrderItem> {
    if (!query) {
      query = this.component.db.collectionGroup(
        firestoreConstants.ORDER_ITEMS_SUB_COLL
      ) as unknown as FirebaseFirestore.Query<FirestoreOrderItem>;
    }
    const updatedQuery = this.addConstraintToQuery(query);
    return this.component.getPossibleMatches(updatedQuery, pageSize);
  }

  abstract addOrderByToQuery(
    query: FirebaseFirestore.Query<FirestoreOrderItem>,
    orderDirection?: OrderDirection
  ): {
    query: FirebaseFirestore.Query<FirestoreOrderItem>;
    getStartAfter: (
      item: FirestoreOrderItem,
      ref: FirebaseFirestore.DocumentReference<FirestoreOrderItem>
    ) => (string | number | FirebaseFirestore.DocumentReference)[];
  };

  protected abstract score: number;

  protected abstract isConstraintSatisfied(orderItem: FirestoreOrderItem): ValidationResponse;

  protected abstract addConstraintToQuery(
    query: FirebaseFirestore.Query<FirestoreOrderItem>
  ): FirebaseFirestore.Query<FirestoreOrderItem>;
}
