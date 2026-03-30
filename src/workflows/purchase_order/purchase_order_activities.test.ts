import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ApplicationFailure } from '@temporalio/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInitialSnapshot } from '../../shared/offline_ordering/domain';
import {
  notifyException,
  publishOrderProjection,
  sendOrderToVendor,
  writeAuditLog,
} from './purchase_order_activities';

const sampleOrder = {
  orderId: 'PO-10001',
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
  notes: 'Demo order',
};

describe('purchase order activities', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ordering-demo-'));
    process.env.ORDERING_DEMO_DATA_DIR = dataDir;
  });

  afterEach(() => {
    process.env.ORDERING_DEMO_DATA_DIR = undefined;
    process.env.VENDOR_SIM_BASE_URL = undefined;
    vi.restoreAllMocks();
  });

  it('should submit the order to the vendor simulator and persist the vendor record', async () => {
    process.env.VENDOR_SIM_BASE_URL = 'http://vendor-sim.test';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          vendorReference: 'ACME-PO-10001',
          acceptedAt: '2026-03-30T10:05:00.000Z',
        }),
        { status: 200 },
      ),
    );

    const acceptance = await sendOrderToVendor(sampleOrder);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://vendor-sim.test/orders');
    expect(acceptance.vendorReference).toBe('ACME-PO-10001');
    expect(acceptance.acceptedAt).toBe('2026-03-30T10:05:00.000Z');

    const storedVendorRecord = JSON.parse(
      await readFile(path.join(dataDir, 'vendor-orders', 'PO-10001.json'), 'utf8'),
    ) as { vendorReference: string };

    expect(storedVendorRecord.vendorReference).toBe('ACME-PO-10001');
  });

  it('should raise a non-retryable failure for vendor validation errors', async () => {
    process.env.VENDOR_SIM_BASE_URL = 'http://vendor-sim.test';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid order' }), { status: 422 }),
    );

    await expect(sendOrderToVendor(sampleOrder)).rejects.toBeInstanceOf(ApplicationFailure);
  });

  it('should write projections, audit events, and notifications to demo storage', async () => {
    const snapshot = createInitialSnapshot(sampleOrder);
    snapshot.submitted = true;
    snapshot.currentStatus = 'SUBMITTED';
    snapshot.baseStatus = 'SUBMITTED';

    await publishOrderProjection(snapshot);
    await writeAuditLog({
      eventId: 'evt-1',
      type: 'ORDER_SUBMITTED',
      orderId: snapshot.orderId,
      source: 'SYSTEM',
      occurredAt: '2026-03-30T10:05:00.000Z',
      receivedAt: '2026-03-30T10:05:00.000Z',
      payload: {},
    });
    await notifyException(snapshot.orderId, 'No acknowledgment received within 1 day.');

    const storedProjection = JSON.parse(
      await readFile(path.join(dataDir, 'orders', 'PO-10001.json'), 'utf8'),
    ) as { orderId: string; currentStatus: string };
    const auditLog = await readFile(path.join(dataDir, 'audit-log.jsonl'), 'utf8');
    const notificationsLog = await readFile(path.join(dataDir, 'notifications.jsonl'), 'utf8');

    expect(storedProjection.orderId).toBe('PO-10001');
    expect(storedProjection.currentStatus).toBe('SUBMITTED');
    expect(auditLog).toContain('"eventId":"evt-1"');
    expect(notificationsLog).toContain('No acknowledgment received within 1 day.');
  });
});
