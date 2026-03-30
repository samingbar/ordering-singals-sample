import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { OrderEvent, OrderSnapshot } from './domain';
import {
  type OrderSummary,
  type PurchaseOrder,
  type VendorAcceptance,
  toOrderSummary,
} from './domain';

export interface VendorOrderRecord {
  orderId: string;
  vendorId: string;
  vendorName: string;
  vendorReference: string;
  acceptedAt: string;
  order: PurchaseOrder;
  lastVendorEvent?: OrderEvent;
}

function getDataRoot(): string {
  return process.env.ORDERING_DEMO_DATA_DIR ?? path.resolve(process.cwd(), 'data');
}

function getOrdersDir(): string {
  return path.join(getDataRoot(), 'orders');
}

function getVendorOrdersDir(): string {
  return path.join(getDataRoot(), 'vendor-orders');
}

function getMetaFile(): string {
  return path.join(getDataRoot(), 'meta.json');
}

function getAuditLogFile(): string {
  return path.join(getDataRoot(), 'audit-log.jsonl');
}

function getNotificationsLogFile(): string {
  return path.join(getDataRoot(), 'notifications.jsonl');
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const fileContents = await readFile(filePath, 'utf8');
    return JSON.parse(fileContents) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function ensureDemoDataDirectories(): Promise<void> {
  await mkdir(getOrdersDir(), { recursive: true });
  await mkdir(getVendorOrdersDir(), { recursive: true });
}

export async function nextOrderId(): Promise<string> {
  await ensureDemoDataDirectories();

  const meta = await readJsonFile<{ nextOrderNumber: number }>(getMetaFile(), {
    nextOrderNumber: 10_001,
  });
  const orderId = `PO-${meta.nextOrderNumber}`;

  await writeJsonFile(getMetaFile(), { nextOrderNumber: meta.nextOrderNumber + 1 });
  return orderId;
}

export async function saveOrderProjection(snapshot: OrderSnapshot): Promise<void> {
  await ensureDemoDataDirectories();
  await writeJsonFile(path.join(getOrdersDir(), `${snapshot.orderId}.json`), snapshot);
}

export async function readOrderProjection(orderId: string): Promise<OrderSnapshot | null> {
  await ensureDemoDataDirectories();
  return readJsonFile<OrderSnapshot | null>(path.join(getOrdersDir(), `${orderId}.json`), null);
}

export async function listOrderSummaries(): Promise<OrderSummary[]> {
  await ensureDemoDataDirectories();

  const fileNames = await readdir(getOrdersDir());
  const snapshots = await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith('.json'))
      .map(async (fileName) => {
        const orderId = fileName.replace(/\.json$/, '');
        return readOrderProjection(orderId);
      }),
  );

  return snapshots
    .filter((snapshot): snapshot is OrderSnapshot => snapshot !== null)
    .map((snapshot) => toOrderSummary(snapshot))
    .sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt));
}

export async function appendAuditLogEvent(event: OrderEvent): Promise<void> {
  await ensureDemoDataDirectories();
  await appendFile(getAuditLogFile(), `${JSON.stringify(event)}\n`, 'utf8');
}

export async function appendExceptionNotification(
  orderId: string,
  message: string,
  sentAt: string,
): Promise<void> {
  await ensureDemoDataDirectories();
  await appendFile(
    getNotificationsLogFile(),
    `${JSON.stringify({ orderId, message, sentAt })}\n`,
    'utf8',
  );
}

export async function saveVendorOrderRecord(record: VendorOrderRecord): Promise<void> {
  await ensureDemoDataDirectories();
  await writeJsonFile(path.join(getVendorOrdersDir(), `${record.orderId}.json`), record);
}

export async function readVendorOrderRecord(orderId: string): Promise<VendorOrderRecord | null> {
  await ensureDemoDataDirectories();
  return readJsonFile<VendorOrderRecord | null>(
    path.join(getVendorOrdersDir(), `${orderId}.json`),
    null,
  );
}

export async function listVendorOrderRecords(): Promise<VendorOrderRecord[]> {
  await ensureDemoDataDirectories();

  const fileNames = await readdir(getVendorOrdersDir());
  const records = await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith('.json'))
      .map(async (fileName) => readVendorOrderRecord(fileName.replace(/\.json$/, ''))),
  );

  return records
    .filter((record): record is VendorOrderRecord => record !== null)
    .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt));
}

export async function rememberVendorAcceptance(
  order: PurchaseOrder,
  acceptance: VendorAcceptance,
): Promise<VendorOrderRecord> {
  const record: VendorOrderRecord = {
    orderId: order.orderId,
    vendorId: order.vendorId,
    vendorName: order.vendorName,
    vendorReference:
      acceptance.vendorReference ?? `${order.vendorId.toUpperCase()}-${order.orderId}`,
    acceptedAt: acceptance.acceptedAt,
    order,
  };

  await saveVendorOrderRecord(record);
  return record;
}

export async function rememberVendorEvent(orderId: string, event: OrderEvent): Promise<void> {
  const record = await readVendorOrderRecord(orderId);

  if (!record) {
    return;
  }

  await saveVendorOrderRecord({
    ...record,
    lastVendorEvent: event,
  });
}
