import {
  ClientOpts,
  DEVNET_URL,
  FetchFn,
  HIRO_MAINNET_URL,
  HIRO_TESTNET_URL,
  createFetchFn,
} from '@funai/common';
import { AddressVersion, ChainId, PeerNetworkId, TransactionVersion } from './constants';
import { ClientParam } from '@funai/common';

export type FunaiNetwork = {
  chainId: number;
  transactionVersion: number; // todo: txVersion better?
  peerNetworkId: number;
  magicBytes: string;
  bootAddress: string;
  addressVersion: {
    singleSig: number;
    multiSig: number;
  };
  // todo: add check32 character bytes string
  client: {
    baseUrl: string; // URL is always required
    fetch?: FetchFn; // fetch is optional and will be created by default in fetch helpers
  };
};

/** @deprecated Use FunaiNetwork */
export type StacksNetwork = FunaiNetwork;

export interface NetworkParam {
  network?: FunaiNetworkName | FunaiNetwork;
}

export type NetworkClientParam = NetworkParam & ClientParam;

export const FUNAI_MAINNET: FunaiNetwork = {
  chainId: ChainId.Mainnet,
  transactionVersion: TransactionVersion.Mainnet,
  peerNetworkId: PeerNetworkId.Mainnet,
  magicBytes: 'X2', // todo: comment bytes version of magic bytes
  bootAddress: 'SP000000000000000000002Q6VF78',
  addressVersion: {
    singleSig: AddressVersion.MainnetSingleSig,
    multiSig: AddressVersion.MainnetMultiSig,
  },
  client: { baseUrl: HIRO_MAINNET_URL },
};

export const FUNAI_TESTNET: FunaiNetwork = {
  chainId: ChainId.Testnet,
  transactionVersion: TransactionVersion.Testnet,
  peerNetworkId: PeerNetworkId.Testnet,
  magicBytes: 'T2', // todo: comment bytes version of magic bytes
  bootAddress: 'ST000000000000000000002AMW42H',
  addressVersion: {
    singleSig: AddressVersion.TestnetSingleSig,
    multiSig: AddressVersion.TestnetMultiSig,
  },
  client: { baseUrl: HIRO_TESTNET_URL },
};

export const FUNAI_DEVNET: FunaiNetwork = {
  ...FUNAI_TESTNET, // todo: ensure deep copy
  addressVersion: { ...FUNAI_TESTNET.addressVersion }, // deep copy
  magicBytes: 'id', // todo: comment bytes version of magic bytes
  client: { baseUrl: DEVNET_URL },
};

export const FUNAI_MOCKNET: FunaiNetwork = {
  ...FUNAI_DEVNET,
  addressVersion: { ...FUNAI_DEVNET.addressVersion }, // deep copy
  client: { ...FUNAI_DEVNET.client }, // deep copy
};

/** @ignore internal */
export const FunaiNetworks = ['mainnet', 'testnet', 'devnet', 'mocknet'] as const;
/** The enum-style names of different common Funai networks */
export type FunaiNetworkName = (typeof FunaiNetworks)[number];

/** @deprecated Use FunaiNetworks */
export const StacksNetworks = FunaiNetworks;
/** @deprecated Use FunaiNetworkName */
export type StacksNetworkName = FunaiNetworkName;

/**
 * Returns the default network for a given name
 * @example
 * ```ts
 * networkFromName('mainnet') // same as FUNAI_MAINNET
 * networkFromName('testnet') // same as FUNAI_TESTNET
 * networkFromName('devnet') // same as FUNAI_DEVNET
 * networkFromName('mocknet') // same as FUNAI_MOCKNET
 * ```
 */
export function networkFromName(name: FunaiNetworkName) {
  switch (name) {
    case 'mainnet':
      return FUNAI_MAINNET;
    case 'testnet':
      return FUNAI_TESTNET;
    case 'devnet':
      return FUNAI_DEVNET;
    case 'mocknet':
      return FUNAI_MOCKNET;
    default:
      throw new Error(`Unknown network name: ${name}`);
  }
}

/** @ignore */
export function networkFrom(network: FunaiNetworkName | FunaiNetwork) {
  if (typeof network === 'string') return networkFromName(network);
  return network;
}

/** @ignore */
export function defaultUrlFromNetwork(network?: FunaiNetworkName | FunaiNetwork) {
  if (!network) return HIRO_MAINNET_URL; // default to mainnet if no network is given

  network = networkFrom(network);

  return !network || network.transactionVersion === TransactionVersion.Mainnet
    ? HIRO_MAINNET_URL // default to mainnet if txVersion is mainnet
    : network.magicBytes === 'id'
      ? DEVNET_URL // default to devnet if magicBytes are devnet
      : HIRO_TESTNET_URL;
}

/**
 * Returns the client of a network, creating a new fetch function if none is available
 */
export function clientFromNetwork(network: FunaiNetwork): Required<ClientOpts> {
  if (network.client.fetch) return network.client as Required<ClientOpts>;
  return {
    ...network.client,
    fetch: createFetchFn(),
  };
}
