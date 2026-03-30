import { Client, Connection } from '@temporalio/client';
import { NativeConnection } from '@temporalio/worker';

export const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';

export async function createClient(): Promise<Client> {
  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  return new Client({ connection });
}

export async function createWorkerConnection(): Promise<NativeConnection> {
  return NativeConnection.connect({ address: TEMPORAL_ADDRESS });
}
