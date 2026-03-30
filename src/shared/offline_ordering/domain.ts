export type OrderEventType =
  | 'ORDER_SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'CONFIRMED'
  | 'ASN_RECEIVED'
  | 'MARKED_RECEIVED'
  | 'INVOICE_RECEIVED'
  | 'CREDIT_POSTED'
  | 'RECONCILED'
  | 'CANCELED'
  | 'EXCEPTION_NOTED';

export type OrderEventSource = 'UI' | 'VENDOR' | 'SYSTEM';

export type OrderStatus =
  | 'CREATED'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'CONFIRMED'
  | 'IN_TRANSIT'
  | 'RECEIVED'
  | 'INVOICED'
  | 'RECONCILING'
  | 'COMPLETED'
  | 'CANCELED'
  | 'EXCEPTION';

export interface PurchaseOrderLineItem {
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface PurchaseOrder {
  orderId: string;
  vendorId: string;
  vendorName: string;
  createdAt: string;
  requestedShipDate: string;
  currency: string;
  lineItems: PurchaseOrderLineItem[];
  shippingAddress?: string;
  notes?: string;
  externalReference?: string;
}

export interface OrderEvent {
  eventId: string;
  type: OrderEventType;
  orderId: string;
  source: OrderEventSource;
  occurredAt: string;
  receivedAt: string;
  actor?: string;
  payload?: Record<string, unknown>;
  warnings?: string[];
}

export interface OrderException {
  code: string;
  message: string;
  openedAt: string;
}

export interface OrderSnapshot {
  orderId: string;
  order: PurchaseOrder;
  vendorId: string;
  vendorName: string;
  vendorReference?: string;
  submitted: boolean;
  acknowledged: boolean;
  confirmed: boolean;
  asnReceived: boolean;
  markedReceived: boolean;
  invoiceReceived: boolean;
  creditPosted: boolean;
  reconciled: boolean;
  canceled: boolean;
  submittedAt?: string;
  acknowledgedAt?: string;
  confirmedAt?: string;
  asnReceivedAt?: string;
  markedReceivedAt?: string;
  invoiceReceivedAt?: string;
  creditPostedAt?: string;
  reconciledAt?: string;
  canceledAt?: string;
  currentStatus: OrderStatus;
  baseStatus: OrderStatus;
  exceptions: string[];
  openExceptions: OrderException[];
  timeline: OrderEvent[];
  lastUpdatedAt: string;
}

export interface OrderSummary {
  orderId: string;
  vendorId: string;
  vendorName: string;
  requestedShipDate: string;
  currentStatus: OrderStatus;
  exceptionCount: number;
  lastUpdatedAt: string;
  vendorReference?: string;
}

export interface StartPurchaseOrderInput {
  order: PurchaseOrder;
}

export interface CancelOrderSignalInput {
  reason: string;
  actor?: string;
  occurredAt: string;
  receivedAt: string;
}

export interface VendorAcceptance {
  vendorReference?: string;
  acceptedAt: string;
}

export interface ApplyOrderEventResult {
  accepted: boolean;
  ignoredReason?: string;
  event?: OrderEvent;
}

export interface TimerAlert {
  code: 'ACK_TIMEOUT' | 'ASN_TIMEOUT' | 'INVOICE_TIMEOUT';
  dueAt: string;
  dueInMs: number;
  message: string;
}

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

function deriveBaseStatus(snapshot: OrderSnapshot): OrderStatus {
  if (snapshot.canceled) {
    return 'CANCELED';
  }

  if (snapshot.reconciled) {
    return 'COMPLETED';
  }

  if (snapshot.invoiceReceived && (snapshot.markedReceived || snapshot.creditPosted)) {
    return 'RECONCILING';
  }

  if (snapshot.invoiceReceived) {
    return 'INVOICED';
  }

  if (snapshot.markedReceived) {
    return 'RECEIVED';
  }

  if (snapshot.asnReceived) {
    return 'IN_TRANSIT';
  }

  if (snapshot.confirmed) {
    return 'CONFIRMED';
  }

  if (snapshot.acknowledged) {
    return 'ACKNOWLEDGED';
  }

  if (snapshot.submitted) {
    return 'SUBMITTED';
  }

  return 'CREATED';
}

export function deriveCurrentStatus(snapshot: OrderSnapshot): OrderStatus {
  const baseStatus = deriveBaseStatus(snapshot);

  if (baseStatus === 'CANCELED' || baseStatus === 'COMPLETED') {
    return baseStatus;
  }

  if (snapshot.openExceptions.length > 0) {
    return 'EXCEPTION';
  }

  return baseStatus;
}

function syncDerivedFields(snapshot: OrderSnapshot): void {
  snapshot.baseStatus = deriveBaseStatus(snapshot);
  snapshot.currentStatus = deriveCurrentStatus(snapshot);
  snapshot.exceptions = snapshot.openExceptions.map((exception) => exception.message);
}

function getEventEffectiveAt(event: OrderEvent): string {
  return event.occurredAt || event.receivedAt;
}

function hasOpenException(snapshot: OrderSnapshot, code: string): boolean {
  return snapshot.openExceptions.some((exception) => exception.code === code);
}

function openException(
  snapshot: OrderSnapshot,
  code: string,
  message: string,
  openedAt: string,
): void {
  if (hasOpenException(snapshot, code)) {
    return;
  }

  snapshot.openExceptions.push({
    code,
    message,
    openedAt,
  });
}

function resolveException(snapshot: OrderSnapshot, code: string): void {
  snapshot.openExceptions = snapshot.openExceptions.filter((exception) => exception.code !== code);
}

function collectWarnings(snapshot: OrderSnapshot, event: OrderEvent): string[] {
  const warnings: string[] = [];

  if (event.type === 'CONFIRMED' && !snapshot.acknowledged) {
    warnings.push('Confirmation arrived before acknowledgment.');
  }

  if (event.type === 'ASN_RECEIVED' && !snapshot.confirmed) {
    warnings.push('ASN arrived before confirmation.');
  }

  if (event.type === 'INVOICE_RECEIVED' && !snapshot.markedReceived) {
    warnings.push('Invoice arrived before receipt was recorded.');
  }

  if (event.type === 'CREDIT_POSTED' && !snapshot.invoiceReceived) {
    warnings.push('Credit posted before any invoice was recorded.');
  }

  if (event.type === 'RECONCILED' && !snapshot.invoiceReceived) {
    warnings.push('Reconciliation completed before any invoice was recorded.');
  }

  return warnings;
}

function applyMilestone(snapshot: OrderSnapshot, event: OrderEvent): void {
  const effectiveAt = getEventEffectiveAt(event);

  switch (event.type) {
    case 'ORDER_SUBMITTED':
      snapshot.submitted = true;
      snapshot.submittedAt ??= effectiveAt;
      if (typeof event.payload?.vendorReference === 'string') {
        snapshot.vendorReference = event.payload.vendorReference;
      }
      break;
    case 'ACKNOWLEDGED':
      snapshot.acknowledged = true;
      snapshot.acknowledgedAt ??= effectiveAt;
      resolveException(snapshot, 'ACK_TIMEOUT');
      break;
    case 'CONFIRMED':
      snapshot.confirmed = true;
      snapshot.confirmedAt ??= effectiveAt;
      break;
    case 'ASN_RECEIVED':
      snapshot.asnReceived = true;
      snapshot.asnReceivedAt ??= effectiveAt;
      resolveException(snapshot, 'ASN_TIMEOUT');
      break;
    case 'MARKED_RECEIVED':
      snapshot.markedReceived = true;
      snapshot.markedReceivedAt ??= effectiveAt;
      break;
    case 'INVOICE_RECEIVED':
      snapshot.invoiceReceived = true;
      snapshot.invoiceReceivedAt ??= effectiveAt;
      resolveException(snapshot, 'INVOICE_TIMEOUT');
      break;
    case 'CREDIT_POSTED':
      snapshot.creditPosted = true;
      snapshot.creditPostedAt ??= effectiveAt;
      break;
    case 'RECONCILED':
      snapshot.reconciled = true;
      snapshot.reconciledAt ??= effectiveAt;
      snapshot.openExceptions = [];
      break;
    case 'CANCELED':
      snapshot.canceled = true;
      snapshot.canceledAt ??= effectiveAt;
      snapshot.openExceptions = [];
      break;
    case 'EXCEPTION_NOTED': {
      const code = typeof event.payload?.code === 'string' ? event.payload.code : 'EXCEPTION';
      const message =
        typeof event.payload?.message === 'string'
          ? event.payload.message
          : 'Exception noted by workflow.';

      openException(snapshot, code, message, event.receivedAt);
      break;
    }
    default:
      break;
  }
}

export function createInitialSnapshot(order: PurchaseOrder): OrderSnapshot {
  const snapshot: OrderSnapshot = {
    orderId: order.orderId,
    order,
    vendorId: order.vendorId,
    vendorName: order.vendorName,
    submitted: false,
    acknowledged: false,
    confirmed: false,
    asnReceived: false,
    markedReceived: false,
    invoiceReceived: false,
    creditPosted: false,
    reconciled: false,
    canceled: false,
    currentStatus: 'CREATED',
    baseStatus: 'CREATED',
    exceptions: [],
    openExceptions: [],
    timeline: [],
    lastUpdatedAt: order.createdAt,
  };

  syncDerivedFields(snapshot);
  return snapshot;
}

export function applyOrderEvent(
  snapshot: OrderSnapshot,
  seenEventIds: Set<string>,
  incomingEvent: OrderEvent,
): ApplyOrderEventResult {
  if (incomingEvent.orderId !== snapshot.orderId) {
    return {
      accepted: false,
      ignoredReason: 'Event orderId does not match workflow order.',
    };
  }

  if (seenEventIds.has(incomingEvent.eventId)) {
    return {
      accepted: false,
      ignoredReason: 'Duplicate eventId ignored.',
    };
  }

  if ((snapshot.canceled || snapshot.reconciled) && incomingEvent.type !== 'EXCEPTION_NOTED') {
    return {
      accepted: false,
      ignoredReason: 'Workflow is already terminal.',
    };
  }

  const storedEvent: OrderEvent = {
    ...incomingEvent,
    payload: incomingEvent.payload ?? {},
    warnings: collectWarnings(snapshot, incomingEvent),
  };

  applyMilestone(snapshot, storedEvent);
  seenEventIds.add(storedEvent.eventId);
  snapshot.timeline.push(storedEvent);
  snapshot.lastUpdatedAt = storedEvent.receivedAt;
  syncDerivedFields(snapshot);

  return {
    accepted: true,
    event: storedEvent,
  };
}

export function buildSubmittedEvent(
  orderId: string,
  acceptedAt: string,
  vendorReference?: string,
): OrderEvent {
  return {
    eventId: `submitted-${orderId}`,
    type: 'ORDER_SUBMITTED',
    orderId,
    source: 'SYSTEM',
    occurredAt: acceptedAt,
    receivedAt: acceptedAt,
    payload: vendorReference ? { vendorReference } : {},
  };
}

export function buildTimerExceptionEvent(orderId: string, timerAlert: TimerAlert): OrderEvent {
  return {
    eventId: `${timerAlert.code}-${orderId}`,
    type: 'EXCEPTION_NOTED',
    orderId,
    source: 'SYSTEM',
    occurredAt: timerAlert.dueAt,
    receivedAt: timerAlert.dueAt,
    payload: {
      code: timerAlert.code,
      message: timerAlert.message,
    },
  };
}

export function buildCancelEvent(orderId: string, input: CancelOrderSignalInput): OrderEvent {
  return {
    eventId: `cancel-${orderId}-${input.receivedAt}`,
    type: 'CANCELED',
    orderId,
    source: 'UI',
    actor: input.actor,
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    payload: {
      reason: input.reason,
    },
  };
}

function createTimerAlert(
  code: TimerAlert['code'],
  dueAt: string,
  nowMs: number,
  message: string,
): TimerAlert | null {
  const dueAtMs = Date.parse(dueAt);

  if (!Number.isFinite(dueAtMs)) {
    return null;
  }

  return {
    code,
    dueAt,
    dueInMs: Math.max(0, dueAtMs - nowMs),
    message,
  };
}

export function computeNextTimerAlert(snapshot: OrderSnapshot, nowMs: number): TimerAlert | null {
  const candidates: TimerAlert[] = [];

  if (snapshot.submitted && !snapshot.acknowledged && !hasOpenException(snapshot, 'ACK_TIMEOUT')) {
    const dueAt = new Date(
      Date.parse(snapshot.submittedAt ?? snapshot.lastUpdatedAt) + ONE_DAY_MS,
    ).toISOString();
    const timer = createTimerAlert(
      'ACK_TIMEOUT',
      dueAt,
      nowMs,
      'No vendor acknowledgment received within 1 day of submission.',
    );

    if (timer) {
      candidates.push(timer);
    }
  }

  if (
    snapshot.confirmed &&
    !snapshot.asnReceived &&
    !hasOpenException(snapshot, 'ASN_TIMEOUT') &&
    snapshot.confirmedAt
  ) {
    const dueAt = new Date(Date.parse(snapshot.confirmedAt) + SEVEN_DAYS_MS).toISOString();
    const timer = createTimerAlert(
      'ASN_TIMEOUT',
      dueAt,
      nowMs,
      'No ASN received within 7 days of confirmation.',
    );

    if (timer) {
      candidates.push(timer);
    }
  }

  if (
    snapshot.markedReceived &&
    !snapshot.invoiceReceived &&
    !hasOpenException(snapshot, 'INVOICE_TIMEOUT') &&
    snapshot.markedReceivedAt
  ) {
    const dueAt = new Date(Date.parse(snapshot.markedReceivedAt) + SEVEN_DAYS_MS).toISOString();
    const timer = createTimerAlert(
      'INVOICE_TIMEOUT',
      dueAt,
      nowMs,
      'No invoice received within 7 days of receipt.',
    );

    if (timer) {
      candidates.push(timer);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((left, right) => left.dueInMs - right.dueInMs)[0] ?? null;
}

export function isTerminal(snapshot: OrderSnapshot): boolean {
  return snapshot.canceled || snapshot.reconciled;
}

export function cloneSnapshot(snapshot: OrderSnapshot): OrderSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as OrderSnapshot;
}

export function toOrderSummary(snapshot: OrderSnapshot): OrderSummary {
  return {
    orderId: snapshot.orderId,
    vendorId: snapshot.vendorId,
    vendorName: snapshot.vendorName,
    requestedShipDate: snapshot.order.requestedShipDate,
    currentStatus: snapshot.currentStatus,
    exceptionCount: snapshot.openExceptions.length,
    lastUpdatedAt: snapshot.lastUpdatedAt,
    vendorReference: snapshot.vendorReference,
  };
}
