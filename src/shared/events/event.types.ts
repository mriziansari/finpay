// Payload for each event
export interface PaymentCompletedPayload {
    paymentId: string;
    merchantId: string;
    amount: string;
    currency: string;
}

export interface PaymentFailedPayload {
    paymentId: string;
    merchantId: string;
    amount: string;
    currency: string;
    failureReason:string;
}

export interface PayoutCompletedPayload {
  payoutId: string;
  merchantId: string;
  amount: string;
  currency: string;
}
export interface RefundCompletedPayload {
  refundId: string;
  paymentId: string;
  merchantId: string;
  amount: string;
  currency: string;
}

// Concrete Domain Events
export interface PaymentCompletedEvent {
  eventType: "payment.completed";
  aggregateType: "Payment";
  aggregateId: string;
  payload: PaymentCompletedPayload;
}
export interface PaymentFailedEvent {
  eventType: "payment.failed";
  aggregateType: "Payment";
  aggregateId: string;
  payload: PaymentFailedPayload;
}
export interface PayoutCompletedEvent {
  eventType: "payout.completed";
  aggregateType: "Payout";
  aggregateId: string;
  payload: PayoutCompletedPayload;
}
export interface RefundCompletedEvent {
  eventType: "refund.completed";
  aggregateType: "Refund";
  aggregateId: string;
  payload: RefundCompletedPayload;
}

//Union of all Domain Event
export type DomainEvent = |PaymentCompletedEvent | PaymentFailedEvent | PayoutCompletedEvent | RefundCompletedEvent;

export type DomainEventType = DomainEvent["eventType"];
// Helper to extract payload for a given eventType
export type EventPayloadFor<T extends DomainEventType> = Extract<DomainEvent, { eventType: T }>["payload"];