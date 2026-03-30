import { ApplicationFailure } from '@temporalio/common';

import type {
  OrderEvent,
  OrderSnapshot,
  PurchaseOrder,
  VendorAcceptance,
} from '../../shared/offline_ordering/domain';
import {
  appendAuditLogEvent,
  appendExceptionNotification,
  rememberVendorAcceptance,
  saveOrderProjection,
} from '../../shared/offline_ordering/storage';

const DEFAULT_VENDOR_SIM_BASE_URL = 'http://localhost:4001';

function getVendorSimBaseUrl(): string {
  return process.env.VENDOR_SIM_BASE_URL ?? DEFAULT_VENDOR_SIM_BASE_URL;
}

export async function sendOrderToVendor(order: PurchaseOrder): Promise<VendorAcceptance> {
  const response = await fetch(`${getVendorSimBaseUrl()}/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ order }),
  });

  if (!response.ok) {
    const body = await response.text();

    if (response.status >= 400 && response.status < 500) {
      throw ApplicationFailure.nonRetryable(
        `Vendor rejected order ${order.orderId}: ${body}`,
        'VENDOR_VALIDATION_ERROR',
      );
    }

    throw new Error(`Vendor simulator failed for ${order.orderId}: ${response.status} ${body}`);
  }

  const acceptance = (await response.json()) as VendorAcceptance;
  await rememberVendorAcceptance(order, acceptance);
  return acceptance;
}

export async function publishOrderProjection(snapshot: OrderSnapshot): Promise<void> {
  await saveOrderProjection(snapshot);
}

export async function notifyException(orderId: string, message: string): Promise<void> {
  await appendExceptionNotification(orderId, message, new Date().toISOString());
}

export async function writeAuditLog(event: OrderEvent): Promise<void> {
  await appendAuditLogEvent(event);
}
