import { FetchFn, Hex, createFetchFn } from '@funai/common';
import {
  NetworkParam,
  FUNAI_MAINNET,
  FunaiNetwork,
  FunaiNetworkName,
  TransactionVersion,
  defaultUrlFromNetwork,
  networkFrom,
} from '@funai/network';
import {
  BurnchainRewardListResponse,
  BurnchainRewardSlotHolderListResponse,
  BurnchainRewardsTotal,
} from '@stacks/stacks-blockchain-api-types';
import {
  Cl,
  ClarityAbi,
  ContractIdString,
  FeeEstimation,
  FunaiTransactionWire,
  TxBroadcastResult,
  broadcastTransaction,
  fetchAbi,
  fetchFeeEstimateTransaction,
  fetchNonce,
} from '@funai/transactions';
import {
  ApiResponse,
  BaseErrorResponse,
  CompleteTaskRequest,
  ExtendedAccountBalances,
  HeartbeatRequest,
  InferenceNodeResponse,
  PaginationOptions,
  RegisterNodeRequest,
  StatsResponse,
  SubmitTaskRequest,
  SubmitTaskResponse,
  TaskStatusResponse,
  V1InfoBlockTimesResponse,
  V2CoreInfoResponse as V2InfoResponse,
  V2PoxInfoResponse,
} from './types';

export class FunaiNodeApi {
  public baseUrl: string;
  public fetch: FetchFn;

  public network: FunaiNetwork;

  constructor({
    baseUrl,
    fetch,
    network = FUNAI_MAINNET,
  }: {
    /** The base API/node URL for the network fetch calls */
    baseUrl?: string;
    /** An optional custom fetch function to override default behaviors */
    fetch?: FetchFn;
  } & NetworkParam = {}) {
    this.baseUrl = baseUrl ?? defaultUrlFromNetwork(network);
    this.fetch = fetch ?? createFetchFn();
    this.network = networkFrom(network);
  }

  /** Returns `true` if the network is configured to 'mainnet', based on the TransactionVersion */
  isMainnet = () => this.network.transactionVersion === TransactionVersion.Mainnet;

  /**
   * Broadcast a serialized transaction to a Funai node (which will validate and forward to the network).
   * @param transaction - The transaction to broadcast
   * @param attachment - Optional attachment to include with the transaction
   * @returns a Promise that resolves to a {@link TxBroadcastResult} object
   */
  broadcastTransaction = async (
    transaction: FunaiTransactionWire,
    attachment?: Uint8Array | string,
    network?: FunaiNetworkName | FunaiNetwork
  ): Promise<TxBroadcastResult> => {
    return broadcastTransaction({ transaction, attachment, network });
  };

  /**
   * Lookup the nonce for an address from a core node
   * @param address - The Funai address to look up the next nonce for
   * @return A promise that resolves to a bigint of the next nonce
   */
  getNonce = async (address: string): Promise<bigint> => {
    return fetchNonce({ address, client: this });
  };

  /**
   * Estimate the total transaction fee in ufunai for a Funai transaction
   * @param payload - The transaction to estimate fees for
   * @param estimatedLength - Optional argument that provides the endpoint with an
   * estimation of the final length (in bytes) of the transaction, including any post-conditions
   * and signatures
   * @return A promise that resolves to an array of {@link FeeEstimate}
   */
  estimateTransaction = async (
    payload: Hex,
    estimatedLength?: number
  ): Promise<[FeeEstimation, FeeEstimation, FeeEstimation]> => {
    return fetchFeeEstimateTransaction({ payload, estimatedLength, client: this });
  };

  /**
   * Fetch a contract's ABI
   * @returns A promise that resolves to a ClarityAbi if the operation succeeds
   */
  getAbi = async (contract: ContractIdString): Promise<ClarityAbi> => {
    const [contractAddress, contractName] = contract.split('.');
    return fetchAbi({ contractAddress, contractName, client: this });
  };

  /** Get funai node info */
  getInfo(): Promise<V2InfoResponse> {
    return this.fetch(`${this.baseUrl}/v2/info`).then(res => res.json());
  }

  /** Get funai node pox info */
  getPoxInfo(): Promise<V2PoxInfoResponse> {
    return this.fetch(`${this.baseUrl}/v2/pox`).then(res => res.json());
  }

  /** Get funai node target block time */
  async getTargetBlockTime() {
    const res = await this.fetch(`${this.baseUrl}/extended/v1/info/network_block_times`).then(
      (res: any): V1InfoBlockTimesResponse => res.json()
    );

    if (this.isMainnet()) return res.mainnet.target_block_time;
    return res.testnet.target_block_time;
  }

  /** Get account status */
  async getAccountInfo(address: string) {
    // todo: add types for response
    return this.fetch(`${this.baseUrl}/v2/accounts/${address}?proof=0`)
      .then(res => res.json())
      .then(json => {
        json.balance = BigInt(json.balance);
        json.locked = BigInt(json.locked);
        return json;
      });
  }

  /** Get extended account balances */
  async getExtendedAccountBalances(address: string): Promise<ExtendedAccountBalances> {
    return this.fetch(`${this.baseUrl}/extended/v1/address/${address}/balances`)
      .then(res => res.json())
      .then(json => {
        json.funai.balance = BigInt(json.funai.balance);
        json.funai.total_sent = BigInt(json.funai.total_sent);
        json.funai.total_received = BigInt(json.funai.total_received);
        json.funai.locked = BigInt(json.funai.locked);
        return json;
      });
  }

  /** Get the total BTC stacking rewards total for an address */
  async getExtendedBtcRewardsTotal(
    /** BTC or STX address */
    address: string
  ): Promise<BurnchainRewardsTotal | BaseErrorResponse> {
    return this.fetch(`${this.baseUrl}/extended/v1/burnchain/rewards/${address}/total`)
      .then(res => res.json())
      .then(json => {
        json.reward_amount = BigInt(json.reward_amount);
        return json;
      });
  }

  /** Get paginated BTC stacking rewards total for an address */
  async getExtendedBtcRewards(
    /** BTC or STX address */
    address: string,
    options?: PaginationOptions
  ): Promise<BurnchainRewardListResponse | BaseErrorResponse> {
    let url = `${this.baseUrl}/extended/v1/burnchain/rewards/${address}`;
    if (options) url += `?limit=${options.limit}&offset=${options.offset}`;

    return this.fetch(url).then(res => res.json());
  }

  /** Get BTC reward holders for the an address */
  async getExtendedBtcRewardHolders(
    /** BTC or STX address */
    address: string,
    options?: PaginationOptions
  ): Promise<BurnchainRewardSlotHolderListResponse | BaseErrorResponse> {
    let url = `${this.baseUrl}/extended/v1/burnchain/reward_slot_holders/${address}`;
    if (options) url += `?limit=${options.limit}&offset=${options.offset}`;

    return this.fetch(url).then(res => res.json());
  }

  /** Gets the value of a data-var if it exists in the given contract */
  async getDataVar(contract: ContractIdString, dataVarName: string) {
    // todo: (contractAddress: string, contractName: string, dataVarName: string) overload?
    // todo: cleanup address/contract identifies types
    const contractPath = contract.replace('.', '/');
    const url = `${this.baseUrl}/v2/data_var/${contractPath}/${dataVarName}?proof=0`;
    return this.fetch(url)
      .then(res => res.json())
      .then(json => ({
        value: Cl.deserialize(json.data),
        raw: json.data as string,
      }));
  }

  /**
   * Submit an inference task to the signer
   * @param request - The task submission request
   * @returns A promise that resolves to the task ID
   */
  async submitInferTask(request: SubmitTaskRequest): Promise<string> {
    const url = `${this.baseUrl}/api/v1/tasks/submit`;
    const response = await this.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    const result: ApiResponse<SubmitTaskResponse> = await response.json();
    if (result.success && result.data) {
      return result.data.task_id;
    } else {
      throw new Error(result.error || 'Failed to submit inference task');
    }
  }

  /**
   * Get the status of an inference task
   * @param taskId - The task ID
   * @returns A promise that resolves to the task status
   */
  async getInferTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    const url = `${this.baseUrl}/api/v1/tasks/${taskId}/status`;
    const response = await this.fetch(url);

    const result: ApiResponse<TaskStatusResponse> = await response.json();
    if (result.success && result.data) {
      return result.data;
    } else {
      throw new Error(result.error || 'Failed to get inference task status');
    }
  }

  /**
   * Register an inference node with the signer
   * @param request - The node registration request
   */
  async registerNode(request: RegisterNodeRequest): Promise<void> {
    const url = `${this.baseUrl}/api/v1/nodes/register`;
    const response = await this.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    const result: ApiResponse<string> = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to register inference node');
    }
  }

  /**
   * Send a heartbeat for an inference node
   * @param request - The heartbeat request
   */
  async heartbeat(request: HeartbeatRequest): Promise<void> {
    const url = `${this.baseUrl}/api/v1/nodes/heartbeat`;
    const response = await this.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    const result: ApiResponse<string> = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to send heartbeat');
    }
  }

  /**
   * Get available tasks for an inference node
   * @param nodeId - The node ID
   * @returns A promise that resolves to the available task (if any)
   */
  async getAvailableTasks(nodeId: string): Promise<TaskStatusResponse | null> {
    const url = `${this.baseUrl}/api/v1/nodes/${nodeId}/tasks`;
    const response = await this.fetch(url);

    if (response.status === 204) {
      return null;
    }

    const result: ApiResponse<TaskStatusResponse> = await response.json();
    if (result.success && result.data) {
      return result.data;
    } else {
      throw new Error(result.error || 'Failed to get available tasks');
    }
  }

  /**
   * Complete an inference task
   * @param request - The completion request
   */
  async completeTask(request: CompleteTaskRequest): Promise<void> {
    const url = `${this.baseUrl}/api/v1/tasks/complete`;
    const response = await this.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    const result: ApiResponse<string> = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to complete task');
    }
  }

  /**
   * Get service statistics
   * @returns A promise that resolves to the stats
   */
  async getStats(): Promise<StatsResponse> {
    const url = `${this.baseUrl}/api/v1/stats`;
    const response = await this.fetch(url);

    const result: ApiResponse<StatsResponse> = await response.json();
    if (result.success && result.data) {
      return result.data;
    } else {
      throw new Error(result.error || 'Failed to get statistics');
    }
  }

  /**
   * Get all inference nodes
   * @returns A promise that resolves to the list of nodes
   */
  async getAllNodes(): Promise<InferenceNodeResponse[]> {
    const url = `${this.baseUrl}/api/v1/nodes`;
    const response = await this.fetch(url);

    const result: ApiResponse<InferenceNodeResponse[]> = await response.json();
    if (result.success && result.data) {
      return result.data;
    } else {
      throw new Error(result.error || 'Failed to get inference nodes');
    }
  }
}
