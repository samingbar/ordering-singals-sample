import { randomUUID } from 'node:crypto';
import path from 'node:path';

import express from 'express';

import type {
  OrderEvent,
  OrderEventType,
  PurchaseOrder,
  VendorAcceptance,
} from '../../shared/offline_ordering/domain';
import {
  listVendorOrderRecords,
  readVendorOrderRecord,
  rememberVendorAcceptance,
  rememberVendorEvent,
} from '../../shared/offline_ordering/storage';

const VENDOR_SIM_PORT = Number(process.env.VENDOR_SIM_PORT ?? '4001');
const publicDir = path.resolve(__dirname, 'public');
const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function createVendorReference(order: PurchaseOrder): string {
  return `${order.vendorId.toUpperCase()}-${order.orderId}`;
}

async function dispatchVendorEvent(event: OrderEvent): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/vendor-events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Unable to deliver vendor event ${event.eventId}: ${response.status} ${body}`);
  }

  await rememberVendorEvent(event.orderId, event);
}

function buildVendorEvent(
  orderId: string,
  type: OrderEventType,
  payload: Record<string, unknown>,
  occurredAt?: string,
  eventId?: string,
): OrderEvent {
  const now = new Date().toISOString();

  return {
    eventId: eventId ?? `vendor-${type.toLowerCase()}-${randomUUID()}`,
    type,
    orderId,
    source: 'VENDOR',
    actor: 'vendor.simulator',
    occurredAt: occurredAt ?? now,
    receivedAt: now,
    payload,
  };
}

async function queueOrDispatchVendorEvent(event: OrderEvent, delaySeconds?: number): Promise<void> {
  if (delaySeconds && delaySeconds > 0) {
    setTimeout(() => {
      void dispatchVendorEvent(event).catch((error) => {
        console.error(error);
      });
    }, delaySeconds * 1000);
    return;
  }

  await dispatchVendorEvent(event);
}

function buildScenarioEvents(orderId: string, scenarioId: string): OrderEvent[] {
  const now = Date.now();
  const at = (offsetMinutes: number) => new Date(now + offsetMinutes * 60_000).toISOString();

  if (scenarioId === 'happy-path') {
    return [
      buildVendorEvent(orderId, 'ACKNOWLEDGED', { note: 'Vendor acknowledged order' }, at(1)),
      buildVendorEvent(orderId, 'CONFIRMED', { note: 'Vendor confirmed fulfillment' }, at(5)),
      buildVendorEvent(orderId, 'ASN_RECEIVED', { trackingNumber: `1Z-${orderId}` }, at(30)),
      buildVendorEvent(orderId, 'INVOICE_RECEIVED', { invoiceNumber: `INV-${orderId}` }, at(240)),
    ];
  }

  if (scenarioId === 'out-of-order') {
    return [
      buildVendorEvent(orderId, 'INVOICE_RECEIVED', { invoiceNumber: `INV-${orderId}` }, at(15)),
      buildVendorEvent(orderId, 'ASN_RECEIVED', { trackingNumber: `TRK-${orderId}` }, at(45)),
    ];
  }

  if (scenarioId === 'duplicate-asn') {
    const eventId = `duplicate-asn-${orderId}`;

    return [
      buildVendorEvent(
        orderId,
        'ASN_RECEIVED',
        { trackingNumber: `TRK-${orderId}` },
        at(30),
        eventId,
      ),
      buildVendorEvent(
        orderId,
        'ASN_RECEIVED',
        { trackingNumber: `TRK-${orderId}` },
        at(30),
        eventId,
      ),
    ];
  }

  throw new Error('Unknown scenario.');
}

async function main(): Promise<void> {
  const app = express();

  app.use(express.json());
  app.use(express.static(publicDir));

  app.get('/api/orders', async (_request, response) => {
    response.json(await listVendorOrderRecords());
  });

  app.post('/orders', async (request, response) => {
    try {
      const body = request.body as { order?: PurchaseOrder };

      if (!body?.order?.orderId) {
        response.status(400).json({ error: 'order is required.' });
        return;
      }

      const acceptance: VendorAcceptance = {
        vendorReference: createVendorReference(body.order),
        acceptedAt: new Date().toISOString(),
      };

      await rememberVendorAcceptance(body.order, acceptance);
      response.status(201).json(acceptance);
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to accept order.',
      });
    }
  });

  app.post('/api/orders/:orderId/events', async (request, response) => {
    try {
      const vendorOrder = await readVendorOrderRecord(request.params.orderId);

      if (!vendorOrder) {
        response.status(404).json({ error: 'Unknown vendor order.' });
        return;
      }

      const body = request.body as Record<string, unknown>;
      const delaySeconds =
        typeof body.delaySeconds === 'number' && body.delaySeconds > 0 ? body.delaySeconds : 0;

      let event: OrderEvent;

      if (body.duplicateLastEvent === true) {
        if (!vendorOrder.lastVendorEvent) {
          response.status(400).json({ error: 'No previous vendor event to duplicate.' });
          return;
        }

        event = {
          ...vendorOrder.lastVendorEvent,
          receivedAt: new Date().toISOString(),
        };
      } else {
        if (!isNonEmptyString(body.type)) {
          response.status(400).json({ error: 'type is required.' });
          return;
        }

        event = buildVendorEvent(
          request.params.orderId,
          body.type as OrderEventType,
          typeof body.payload === 'object' && body.payload !== null
            ? (body.payload as Record<string, unknown>)
            : {},
          isNonEmptyString(body.occurredAt) ? body.occurredAt.trim() : undefined,
          isNonEmptyString(body.eventId) ? body.eventId.trim() : undefined,
        );
      }

      await queueOrDispatchVendorEvent(event, delaySeconds);

      response.status(202).json({
        accepted: true,
        eventId: event.eventId,
        delayed: delaySeconds > 0,
      });
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : 'Unable to send vendor event.',
      });
    }
  });

  app.post('/api/orders/:orderId/scenarios/:scenarioId', async (request, response) => {
    try {
      const events = buildScenarioEvents(request.params.orderId, request.params.scenarioId);

      for (const [index, event] of events.entries()) {
        await queueOrDispatchVendorEvent(event, index + 1);
      }

      response.status(202).json({
        accepted: true,
        scenarioId: request.params.scenarioId,
      });
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : 'Unable to start scenario.',
      });
    }
  });

  app.get('/', (_request, response) => {
    response.sendFile(path.join(publicDir, 'index.html'));
  });

  app.listen(VENDOR_SIM_PORT, () => {
    console.log(`Vendor simulator running at http://localhost:${VENDOR_SIM_PORT}`);
  });
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
