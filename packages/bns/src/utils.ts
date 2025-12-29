import { utf8ToBytes } from '@funai/common';
import { hash160 } from '@funai/transactions';

/** @ignore */
export function decodeFQN(fqdn: string): {
  name: string;
  namespace: string;
  subdomain?: string;
} {
  const nameParts = fqdn.split('.');
  if (nameParts.length > 2) {
    return {
      subdomain: nameParts[0],
      name: nameParts[1],
      namespace: nameParts[2],
    };
  }
  return {
    name: nameParts[0],
    namespace: nameParts[1],
  };
}

/** @ignore */
export const getZonefileHash = (zonefile: string) => hash160(utf8ToBytes(zonefile));
