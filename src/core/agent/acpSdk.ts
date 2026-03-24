import type * as acp from '@agentclientprotocol/sdk';

export type AcpSdk = typeof acp;

let acpSdkPromise: Promise<AcpSdk> | null = null;

export function loadAcpSdk(): Promise<AcpSdk> {
  acpSdkPromise ??= import('@agentclientprotocol/sdk');
  return acpSdkPromise;
}
