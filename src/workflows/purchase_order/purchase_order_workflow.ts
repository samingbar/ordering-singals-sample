import {
  condition,
  defineQuery,
  defineSignal,
  log,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow';

import {
  type CancelOrderSignalInput,
  type OrderEvent,
  type OrderSnapshot,
  type OrderStatus,
  type StartPurchaseOrderInput,
  type VendorAcceptance,
  applyOrderEvent,
  buildCancelEvent,
  buildSubmittedEvent,
  buildTimerExceptionEvent,
  cloneSnapshot,
  computeNextTimerAlert,
  createInitialSnapshot,
  isTerminal,
} from '../../shared/offline_ordering/domain';
import type * as purchaseOrderActivities from './purchase_order_activities';

export const PURCHASE_ORDER_TASK_QUEUE = 'purchase-order-task-queue';

export const recordVendorEventSignal = defineSignal<[OrderEvent]>('recordVendorEvent');
export const recordUserEventSignal = defineSignal<[OrderEvent]>('recordUserEvent');
export const cancelOrderSignal = defineSignal<[CancelOrderSignalInput]>('cancelOrder');

export const getSnapshotQuery = defineQuery<OrderSnapshot>('getSnapshot');
export const getTimelineQuery = defineQuery<OrderEvent[]>('getTimeline');
export const getStatusQuery = defineQuery<OrderStatus>('getStatus');

const activities = proxyActivities<typeof purchaseOrderActivities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
    maximumAttempts: 5,
    nonRetryableErrorTypes: ['VENDOR_VALIDATION_ERROR'],
  },
});

export async function purchaseOrderWorkflow(
  input: StartPurchaseOrderInput,
): Promise<OrderSnapshot> {
  const snapshot = createInitialSnapshot(input.order);
  const seenEventIds = new Set<string>();
  const pendingAuditEvents: OrderEvent[] = [];
  const pendingExceptionNotifications: Array<{ message: string }> = [];
  let stateVersion = 0;

  function ingestEvent(event: OrderEvent): void {
    const result = applyOrderEvent(snapshot, seenEventIds, event);

    if (!result.accepted || !result.event) {
      return;
    }

    pendingAuditEvents.push(result.event);
    stateVersion += 1;
  }

  async function flushSideEffects(): Promise<void> {
    while (pendingAuditEvents.length > 0) {
      const event = pendingAuditEvents.shift();

      if (event) {
        await activities.writeAuditLog(event);
      }
    }

    while (pendingExceptionNotifications.length > 0) {
      const notification = pendingExceptionNotifications.shift();

      if (notification) {
        await activities.notifyException(snapshot.orderId, notification.message);
      }
    }

    await activities.publishOrderProjection(cloneSnapshot(snapshot));
  }

  setHandler(recordVendorEventSignal, (event) => {
    ingestEvent(event);
  });

  setHandler(recordUserEventSignal, (event) => {
    ingestEvent(event);
  });

  setHandler(cancelOrderSignal, (input) => {
    ingestEvent(buildCancelEvent(snapshot.orderId, input));
  });

  setHandler(getSnapshotQuery, () => cloneSnapshot(snapshot));
  setHandler(getTimelineQuery, () => cloneSnapshot(snapshot).timeline);
  setHandler(getStatusQuery, () => snapshot.currentStatus);

  const vendorAcceptance: VendorAcceptance = await activities.sendOrderToVendor(input.order);

  ingestEvent(
    buildSubmittedEvent(
      snapshot.orderId,
      vendorAcceptance.acceptedAt,
      vendorAcceptance.vendorReference,
    ),
  );
  await flushSideEffects();

  while (!isTerminal(snapshot)) {
    const observedVersion = stateVersion;
    const nextTimer = computeNextTimerAlert(snapshot, Date.now());

    if (nextTimer) {
      const wakeupReason = await Promise.race([
        sleep(nextTimer.dueInMs).then(() => 'timer' as const),
        condition(() => stateVersion !== observedVersion).then(() => 'signal' as const),
      ]);

      if (wakeupReason === 'timer') {
        const stillApplicable = computeNextTimerAlert(snapshot, Date.now());

        if (
          stillApplicable &&
          stillApplicable.code === nextTimer.code &&
          stillApplicable.dueInMs === 0
        ) {
          log.info('Timer exception fired', {
            code: nextTimer.code,
            message: nextTimer.message,
            orderId: snapshot.orderId,
          });

          ingestEvent(buildTimerExceptionEvent(snapshot.orderId, nextTimer));
          pendingExceptionNotifications.push({ message: nextTimer.message });
        }
      }
    } else {
      await condition(() => isTerminal(snapshot) || stateVersion !== observedVersion);
    }

    if (stateVersion !== observedVersion || pendingExceptionNotifications.length > 0) {
      await flushSideEffects();
    }
  }

  await flushSideEffects();
  return cloneSnapshot(snapshot);
}
