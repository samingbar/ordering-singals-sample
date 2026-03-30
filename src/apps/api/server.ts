import { randomUUID } from 'node:crypto';
import path from 'node:path';

import express from 'express';

import type {
  CancelOrderSignalInput,
  OrderEvent,
  OrderEventType,
  PurchaseOrder,
  PurchaseOrderLineItem,
  StartPurchaseOrderInput,
} from '../../shared/offline_ordering/domain';
import {
  listOrderSummaries,
  nextOrderId,
  readOrderProjection,
} from '../../shared/offline_ordering/storage';
import { createClient } from '../../shared/temporal';
import {
  PURCHASE_ORDER_TASK_QUEUE,
  cancelOrderSignal,
  getSnapshotQuery,
  getTimelineQuery,
  purchaseOrderWorkflow,
  recordUserEventSignal,
  recordVendorEventSignal,
} from '../../workflows/purchase_order/purchase_order_workflow';

const API_PORT = Number(process.env.API_PORT ?? '4000');
const publicDir = path.resolve(__dirname, 'public');

const allowedManualEventTypes = new Set<OrderEventType>([
  'MARKED_RECEIVED',
  'INVOICE_RECEIVED',
  'CREDIT_POSTED',
  'RECONCILED',
]);

const allowedVendorEventTypes = new Set<OrderEventType>([
  'ACKNOWLEDGED',
  'CONFIRMED',
  'ASN_RECEIVED',
  'INVOICE_RECEIVED',
  'CREDIT_POSTED',
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseLineItems(value: unknown): PurchaseOrderLineItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('At least one line item is required.');
  }

  return value.map((lineItem, index) => {
    if (typeof lineItem !== 'object' || lineItem === null) {
      throw new Error(`Line item ${index + 1} is invalid.`);
    }

    const candidate = lineItem as Record<string, unknown>;

    if (!isNonEmptyString(candidate.sku) || !isNonEmptyString(candidate.description)) {
      throw new Error(`Line item ${index + 1} is missing sku or description.`);
    }

    if (typeof candidate.quantity !== 'number' || candidate.quantity <= 0) {
      throw new Error(`Line item ${index + 1} quantity must be greater than zero.`);
    }

    if (typeof candidate.unitPrice !== 'number' || candidate.unitPrice < 0) {
      throw new Error(`Line item ${index + 1} unitPrice must be zero or greater.`);
    }

    return {
      sku: candidate.sku.trim(),
      description: candidate.description.trim(),
      quantity: candidate.quantity,
      unitPrice: candidate.unitPrice,
    };
  });
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeCreateOrderRequest(value: unknown): PurchaseOrder {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Request body must be an object.');
  }

  const candidate = value as Record<string, unknown>;

  if (!isNonEmptyString(candidate.vendorName)) {
    throw new Error('vendorName is required.');
  }

  if (!isNonEmptyString(candidate.requestedShipDate)) {
    throw new Error('requestedShipDate is required.');
  }

  return {
    orderId: '',
    vendorId: isNonEmptyString(candidate.vendorId)
      ? candidate.vendorId.trim()
      : slugify(candidate.vendorName),
    vendorName: candidate.vendorName.trim(),
    createdAt: new Date().toISOString(),
    requestedShipDate: candidate.requestedShipDate.trim(),
    currency: isNonEmptyString(candidate.currency) ? candidate.currency.trim() : 'USD',
    lineItems: parseLineItems(candidate.lineItems),
    shippingAddress: isNonEmptyString(candidate.shippingAddress)
      ? candidate.shippingAddress.trim()
      : undefined,
    notes: isNonEmptyString(candidate.notes) ? candidate.notes.trim() : undefined,
    externalReference: isNonEmptyString(candidate.externalReference)
      ? candidate.externalReference.trim()
      : undefined,
  };
}

function buildUserEvent(orderId: string, value: unknown): OrderEvent {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Request body must be an object.');
  }

  const candidate = value as Record<string, unknown>;

  if (
    !isNonEmptyString(candidate.type) ||
    !allowedManualEventTypes.has(candidate.type as OrderEventType)
  ) {
    throw new Error('Unsupported manual event type.');
  }

  const now = new Date().toISOString();

  return {
    eventId: isNonEmptyString(candidate.eventId) ? candidate.eventId.trim() : `ui-${randomUUID()}`,
    type: candidate.type as OrderEventType,
    orderId,
    source: 'UI',
    actor: isNonEmptyString(candidate.actor)
      ? candidate.actor.trim()
      : 'demo.user@byteinventory.local',
    occurredAt: isNonEmptyString(candidate.occurredAt) ? candidate.occurredAt.trim() : now,
    receivedAt: now,
    payload:
      typeof candidate.payload === 'object' && candidate.payload !== null
        ? (candidate.payload as Record<string, unknown>)
        : {},
  };
}

function buildCancelSignal(value: unknown): CancelOrderSignalInput {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Request body must be an object.');
  }

  const candidate = value as Record<string, unknown>;
  const now = new Date().toISOString();

  if (!isNonEmptyString(candidate.reason)) {
    throw new Error('reason is required.');
  }

  return {
    reason: candidate.reason.trim(),
    actor: isNonEmptyString(candidate.actor)
      ? candidate.actor.trim()
      : 'demo.user@byteinventory.local',
    occurredAt: isNonEmptyString(candidate.occurredAt) ? candidate.occurredAt.trim() : now,
    receivedAt: now,
  };
}

function normalizeVendorEvent(value: unknown): OrderEvent {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Request body must be an object.');
  }

  const candidate = value as Record<string, unknown>;
  const now = new Date().toISOString();

  if (
    !isNonEmptyString(candidate.type) ||
    !allowedVendorEventTypes.has(candidate.type as OrderEventType)
  ) {
    throw new Error('Unsupported vendor event type.');
  }

  if (!isNonEmptyString(candidate.orderId)) {
    throw new Error('orderId is required.');
  }

  return {
    eventId: isNonEmptyString(candidate.eventId)
      ? candidate.eventId.trim()
      : `vendor-${randomUUID()}`,
    type: candidate.type as OrderEventType,
    orderId: candidate.orderId.trim(),
    source: 'VENDOR',
    actor: isNonEmptyString(candidate.actor) ? candidate.actor.trim() : 'vendor-simulator',
    occurredAt: isNonEmptyString(candidate.occurredAt) ? candidate.occurredAt.trim() : now,
    receivedAt: now,
    payload:
      typeof candidate.payload === 'object' && candidate.payload !== null
        ? (candidate.payload as Record<string, unknown>)
        : {},
  };
}

function createSeedOrders(): Array<Omit<PurchaseOrder, 'orderId'>> {
  const today = new Date();
  const plusDays = (days: number) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };

  return [
    {
      vendorId: 'acme-medical',
      vendorName: 'Acme Medical',
      createdAt: today.toISOString(),
      requestedShipDate: plusDays(5),
      currency: 'USD',
      lineItems: [
        {
          sku: 'GLOVES-001',
          description: 'Nitrile Gloves',
          quantity: 10,
          unitPrice: 24.99,
        },
      ],
      notes: 'Happy path starter order',
    },
    {
      vendorId: 'northwind-clinical',
      vendorName: 'Northwind Clinical',
      createdAt: today.toISOString(),
      requestedShipDate: plusDays(7),
      currency: 'USD',
      lineItems: [
        {
          sku: 'MASK-200',
          description: 'Procedure Masks',
          quantity: 25,
          unitPrice: 12.5,
        },
      ],
      notes: 'Sparse offline path starter order',
    },
    {
      vendorId: 'mesa-labs',
      vendorName: 'Mesa Labs',
      createdAt: today.toISOString(),
      requestedShipDate: plusDays(10),
      currency: 'USD',
      lineItems: [
        {
          sku: 'SWAB-030',
          description: 'Sterile Swabs',
          quantity: 40,
          unitPrice: 6.75,
        },
      ],
      notes: 'Out-of-order demo starter order',
    },
  ];
}

async function startWorkflow(
  client: Awaited<ReturnType<typeof createClient>>,
  order: PurchaseOrder,
) {
  const input: StartPurchaseOrderInput = { order };

  await client.workflow.start(purchaseOrderWorkflow, {
    args: [input],
    taskQueue: PURCHASE_ORDER_TASK_QUEUE,
    workflowId: `purchase-order-${order.orderId}`,
  });
}

async function main(): Promise<void> {
  const client = await createClient();
  const app = express();

  app.use(express.json());
  app.use(express.static(publicDir));

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true });
  });

  app.get('/api/orders', async (_request, response) => {
    response.json(await listOrderSummaries());
  });

  app.post('/api/orders', async (request, response) => {
    try {
      const draftOrder = normalizeCreateOrderRequest(request.body);
      const orderId = await nextOrderId();
      const order: PurchaseOrder = {
        ...draftOrder,
        orderId,
      };

      await startWorkflow(client, order);

      response.status(201).json({
        orderId,
        workflowId: `purchase-order-${orderId}`,
      });
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : 'Unable to create order.',
      });
    }
  });

  app.post('/api/demo/seed', async (_request, response) => {
    try {
      const createdOrderIds: string[] = [];

      for (const draftOrder of createSeedOrders()) {
        const orderId = await nextOrderId();
        const order: PurchaseOrder = {
          ...draftOrder,
          orderId,
        };

        await startWorkflow(client, order);
        createdOrderIds.push(orderId);
      }

      response.status(201).json({
        orderIds: createdOrderIds,
      });
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to seed demo orders.',
      });
    }
  });

  app.get('/api/orders/:orderId', async (request, response) => {
    try {
      const handle = client.workflow.getHandle(`purchase-order-${request.params.orderId}`);
      const snapshot = await handle.query(getSnapshotQuery);

      response.json(snapshot);
    } catch {
      const projection = await readOrderProjection(request.params.orderId);

      if (!projection) {
        response.status(404).json({ error: 'Order not found.' });
        return;
      }

      response.json(projection);
    }
  });

  app.get('/api/orders/:orderId/timeline', async (request, response) => {
    try {
      const handle = client.workflow.getHandle(`purchase-order-${request.params.orderId}`);
      const timeline = await handle.query(getTimelineQuery);

      response.json(timeline);
    } catch {
      response.status(404).json({ error: 'Order not found.' });
    }
  });

  app.post('/api/orders/:orderId/user-events', async (request, response) => {
    try {
      const event = buildUserEvent(request.params.orderId, request.body);
      const handle = client.workflow.getHandle(`purchase-order-${request.params.orderId}`);

      await handle.signal(recordUserEventSignal, event);
      response.status(202).json({ accepted: true, eventId: event.eventId });
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : 'Unable to record user event.',
      });
    }
  });

  app.post('/api/orders/:orderId/cancel', async (request, response) => {
    try {
      const signalInput = buildCancelSignal(request.body);
      const handle = client.workflow.getHandle(`purchase-order-${request.params.orderId}`);

      await handle.signal(cancelOrderSignal, signalInput);
      response.status(202).json({ accepted: true });
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : 'Unable to cancel order.',
      });
    }
  });

  app.post('/api/vendor-events', async (request, response) => {
    try {
      const event = normalizeVendorEvent(request.body);
      const handle = client.workflow.getHandle(`purchase-order-${event.orderId}`);

      await handle.signal(recordVendorEventSignal, event);
      response.status(202).json({ accepted: true, eventId: event.eventId });
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : 'Unable to ingest vendor event.',
      });
    }
  });

  app.get('/', (_request, response) => {
    response.sendFile(path.join(publicDir, 'index.html'));
  });

  app.listen(API_PORT, () => {
    console.log(`ByteInventory demo UI and API running at http://localhost:${API_PORT}`);
  });
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
