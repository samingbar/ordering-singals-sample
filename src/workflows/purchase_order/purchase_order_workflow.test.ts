import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { Worker } from '@temporalio/worker';
import { expect, it } from 'vitest';

import type { OrderEvent, StartPurchaseOrderInput } from '../../shared/offline_ordering/domain';
import { createTaskQueue, withTimeSkippingEnv } from '../../test/temporal';
import {
  cancelOrderSignal,
  getSnapshotQuery,
  purchaseOrderWorkflow,
  recordUserEventSignal,
  recordVendorEventSignal,
} from './purchase_order_workflow';

function createSampleInput(orderId: string): StartPurchaseOrderInput {
  return {
    order: {
      orderId,
      vendorId: 'acme-medical',
      vendorName: 'Acme Medical',
      createdAt: '2026-03-30T10:00:00.000Z',
      requestedShipDate: '2026-04-05',
      currency: 'USD',
      lineItems: [
        {
          sku: 'GLOVES-001',
          description: 'Nitrile Gloves',
          quantity: 10,
          unitPrice: 24.99,
        },
      ],
      notes: 'Temporal demo order',
    },
  };
}

it('should accept out-of-order updates, ignore duplicates, and complete on reconciliation', async () => {
  await withTimeSkippingEnv(async (env) => {
    const taskQueue = createTaskQueue('test-purchase-order');
    const workflowId = `purchase-order-${randomUUID()}`;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      workflowsPath: path.resolve(__dirname, 'purchase_order_workflow.ts'),
      taskQueue,
      activities: {
        async sendOrderToVendor() {
          return {
            vendorReference: 'ACME-REF-1',
            acceptedAt: '2026-03-30T10:00:05.000Z',
          };
        },
        async publishOrderProjection() {},
        async notifyException() {},
        async writeAuditLog() {},
      },
    });

    await worker.runUntil(async () => {
      const handle = await env.client.workflow.start(purchaseOrderWorkflow, {
        args: [createSampleInput('PO-20001')],
        taskQueue,
        workflowId,
      });

      const invoiceEvent: OrderEvent = {
        eventId: 'evt-invoice-1',
        type: 'INVOICE_RECEIVED',
        orderId: 'PO-20001',
        source: 'VENDOR',
        occurredAt: '2026-03-31T12:00:00.000Z',
        receivedAt: '2026-03-31T12:00:05.000Z',
        payload: {
          invoiceNumber: 'INV-20001',
        },
      };
      const receiptEvent: OrderEvent = {
        eventId: 'evt-received-1',
        type: 'MARKED_RECEIVED',
        orderId: 'PO-20001',
        source: 'UI',
        actor: 'buyer@byteinventory.demo',
        occurredAt: '2026-03-31T13:00:00.000Z',
        receivedAt: '2026-03-31T13:00:05.000Z',
        payload: {
          receivedQuantity: 10,
        },
      };
      const reconcileEvent: OrderEvent = {
        eventId: 'evt-reconcile-1',
        type: 'RECONCILED',
        orderId: 'PO-20001',
        source: 'UI',
        actor: 'ap@byteinventory.demo',
        occurredAt: '2026-04-01T08:00:00.000Z',
        receivedAt: '2026-04-01T08:00:05.000Z',
        payload: {
          note: 'Matched in demo',
        },
      };

      await handle.signal(recordVendorEventSignal, invoiceEvent);
      await handle.signal(recordVendorEventSignal, invoiceEvent);
      await handle.signal(recordUserEventSignal, receiptEvent);

      const snapshotBeforeCompletion = await handle.query(getSnapshotQuery);
      const storedInvoiceEvent = snapshotBeforeCompletion.timeline.find(
        (event) => event.eventId === 'evt-invoice-1',
      );

      expect(snapshotBeforeCompletion.invoiceReceived).toBe(true);
      expect(snapshotBeforeCompletion.markedReceived).toBe(true);
      expect(
        snapshotBeforeCompletion.timeline.filter((event) => event.eventId === 'evt-invoice-1'),
      ).toHaveLength(1);
      expect(storedInvoiceEvent?.warnings).toContain(
        'Invoice arrived before receipt was recorded.',
      );

      await handle.signal(recordUserEventSignal, reconcileEvent);
      const result = await handle.result();

      expect(result.currentStatus).toBe('COMPLETED');
      expect(result.reconciled).toBe(true);
      expect(result.vendorReference).toBe('ACME-REF-1');
    });
  });
});

it('should raise and later resolve timer-based exceptions without failing the order', async () => {
  await withTimeSkippingEnv(async (env) => {
    const taskQueue = createTaskQueue('test-purchase-order-timers');
    const workflowId = `purchase-order-${randomUUID()}`;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      workflowsPath: path.resolve(__dirname, 'purchase_order_workflow.ts'),
      taskQueue,
      activities: {
        async sendOrderToVendor() {
          return {
            vendorReference: 'ACME-REF-2',
            acceptedAt: '2026-03-30T10:00:05.000Z',
          };
        },
        async publishOrderProjection() {},
        async notifyException() {},
        async writeAuditLog() {},
      },
    });

    await worker.runUntil(async () => {
      const handle = await env.client.workflow.start(purchaseOrderWorkflow, {
        args: [createSampleInput('PO-20002')],
        taskQueue,
        workflowId,
      });

      await env.sleep(24 * 60 * 60 * 1000 + 60 * 1000);

      const snapshotAfterTimeout = await handle.query(getSnapshotQuery);
      expect(snapshotAfterTimeout.currentStatus).toBe('EXCEPTION');
      expect(snapshotAfterTimeout.exceptions).toContain(
        'No vendor acknowledgment received within 1 day of submission.',
      );

      await handle.signal(recordVendorEventSignal, {
        eventId: 'evt-ack-1',
        type: 'ACKNOWLEDGED',
        orderId: 'PO-20002',
        source: 'VENDOR',
        occurredAt: '2026-03-31T10:05:00.000Z',
        receivedAt: '2026-03-31T10:05:01.000Z',
        payload: {},
      });
      await handle.signal(cancelOrderSignal, {
        reason: 'Timer path demo complete',
        actor: 'buyer@byteinventory.demo',
        occurredAt: '2026-03-31T10:10:00.000Z',
        receivedAt: '2026-03-31T10:10:01.000Z',
      });

      const result = await handle.result();
      expect(result.currentStatus).toBe('CANCELED');
      expect(result.exceptions).toEqual([]);
      expect(result.acknowledged).toBe(true);
    });
  });
});
