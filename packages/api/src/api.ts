import { FetchFn, Hex, createFetchFn, bytesToHex, utf8ToBytes } from '@funai/common';
import { sha256 } from '@noble/hashes/sha256';
import { encryptForSigner } from './encryption-utils';
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
  makeInfer,
  makeContractCall,
  uintCV,
  stringAsciiCV,
  getAddressFromPrivateKey,
  signMessageHashRsv,
  privateKeyToPublic,
} from '@funai/transactions';
import {
  ApiResponse,
  AuthenticatedTaskStatusRequest,
  BaseErrorResponse,
  CompleteTaskRequest,
  EncryptedInferOptions,
  ExtendedAccountBalances,
  HeartbeatRequest,
  InferenceNodeResponse,
  PaginationOptions,
  QueryTaskOptions,
  RegisterNodeRequest,
  SignerPublicKeyResponse,
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

  // ==================== Encryption Methods ====================

  /**
   * Get the Signer's public key for encrypting inference data
   * @returns A promise that resolves to the Signer's public key info
   */
  async getSignerPublicKey(): Promise<SignerPublicKeyResponse> {
    const url = `${this.baseUrl}/api/v1/encryption/public-key`;
    const response = await this.fetch(url);

    const result: ApiResponse<SignerPublicKeyResponse> = await response.json();
    if (result.success && result.data) {
      return result.data;
    } else {
      throw new Error(result.error || 'Failed to get signer public key');
    }
  }

  /**
   * Encrypt data using ECIES (Elliptic Curve Integrated Encryption Scheme)
   * Compatible with the Signer's decryption implementation using AES-256-GCM
   * 
   * Returns a JSON string with the EncryptedData format expected by the Signer:
   * {
   *   signer_public_key: string,
   *   ephemeral_public_key: string,
   *   ciphertext: string,
   *   nonce: string,
   *   signature?: string
   * }
   * 
   * @param plaintext - The plaintext string to encrypt
   * @param recipientPublicKeyHex - The recipient's public key in hex format (Signer's public key)
   * @returns The encrypted data as a JSON string
   */
  async encryptWithPublicKey(plaintext: string, recipientPublicKeyHex: string): Promise<string> {
    return encryptForSigner(plaintext, recipientPublicKeyHex);
  }

  /**
   * Submit an encrypted inference task to the signer
   * Automatically fetches the Signer's public key and encrypts the user input and context
   * 
   * For encrypted tasks:
   * - The on-chain transaction contains a placeholder (hash of encrypted data)
   * - The actual encrypted data is sent via API to the Signer
   * 
   * @param options - The task details including encryption preference
   * @returns A promise that resolves to the task ID
   */
  async submitEncryptedInferenceTask(options: EncryptedInferOptions): Promise<string> {
    const shouldEncrypt = options.encrypt !== false; // Default to true
    const userAddress = getAddressFromPrivateKey(options.privateKey, this.network);

    let apiUserInput = options.userInput;
    let apiContext = options.context;
    let signerPublicKey: string | undefined;
    
    // For on-chain transaction, use shortened placeholders if encrypting
    let txUserInput = options.userInput;
    let txContext = options.context;

    if (shouldEncrypt) {
      // Get Signer's public key
      const signerKeyInfo = await this.getSignerPublicKey();
      signerPublicKey = signerKeyInfo.public_key;
      
      // Encrypt user input and context for API transmission
      apiUserInput = await this.encryptWithPublicKey(options.userInput, signerPublicKey);
      apiContext = await this.encryptWithPublicKey(options.context, signerPublicKey);
      
      // For on-chain transaction, use hash of encrypted data
      // Format: "enc:{first16bytes_of_sha256}" - total 20 chars to fit in tx size limits
      // This allows verification that the encrypted data matches what's on-chain
      const inputHash = bytesToHex(sha256(utf8ToBytes(apiUserInput))).slice(0, 16);
      const contextHash = bytesToHex(sha256(utf8ToBytes(apiContext))).slice(0, 16);
      txUserInput = `enc:${inputHash}`;
      txContext = `enc:${contextHash}`;
    }

    // Create the transaction with placeholder data for encrypted tasks
    const transaction = await makeInfer({
      inferUserAddress: userAddress,
      amount: options.amount,
      userInput: txUserInput,
      context: txContext,
      nodePrincipal: options.nodePrincipal,
      modelName: options.modelName,
      senderKey: options.privateKey,
      network: this.network,
      fee: options.fee,
      nonce: options.nonce,
    });

    const signedTxHex = transaction.serialize();

    // Submit to API with full encrypted data
    return this.submitInferTask({
      task_id: options.taskId,
      user_address: userAddress,
      user_input: apiUserInput,  // Full encrypted data sent via API
      context: apiContext,        // Full encrypted data sent via API
      model_name: options.modelName,
      infer_fee: Number(options.amount),
      max_infer_time: options.maxInferTime,
      fee: options.fee ? Number(options.fee) : undefined,
      nonce: options.nonce ? Number(options.nonce) : undefined,
      signed_tx: signedTxHex,
      is_encrypted: shouldEncrypt,
      signer_public_key: signerPublicKey,
    });
  }

  // ==================== Task Submission Methods ====================

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
   * Submit an inference task to the signer using a private key for automatic signing.
   * Derives the user address from the private key.
   * @param options - The task details and sender's private key
   * @returns A promise that resolves to the task ID
   */
  async submitInferenceTask(options: {
    privateKey: string;
    userInput: string;
    context: string;
    modelName: string;
    amount: number | bigint;
    maxInferTime: number;
    nodePrincipal?: string;
    fee?: number | bigint;
    nonce?: number | bigint;
    taskId?: string;
  }): Promise<string> {
    const userAddress = getAddressFromPrivateKey(options.privateKey, this.network);

    const transaction = await makeInfer({
      inferUserAddress: userAddress,
      amount: options.amount,
      userInput: options.userInput,
      context: options.context,
      nodePrincipal: options.nodePrincipal,
      modelName: options.modelName,
      senderKey: options.privateKey,
      network: this.network,
      fee: options.fee,
      nonce: options.nonce,
    });

    const signedTxHex = transaction.serialize();

    return this.submitInferTask({
      task_id: options.taskId,
      user_address: userAddress,
      user_input: options.userInput,
      context: options.context,
      model_name: options.modelName,
      infer_fee: Number(options.amount),
      max_infer_time: options.maxInferTime,
      fee: options.fee ? Number(options.fee) : undefined,
      nonce: options.nonce ? Number(options.nonce) : undefined,
      signed_tx: signedTxHex,
    });
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

  /**
   * Query inference task status with authentication.
   * Only the user who submitted the task can query its status and result.
   * 
   * @param options - The task ID and user's private key
   * @returns A promise that resolves to the task status including result if completed
   * 
   * @example
   * ```typescript
   * const api = new FunaiNodeApi({ baseUrl: 'http://localhost:8080' });
   * const status = await api.queryInferenceTaskStatus({
   *   taskId: 'api-12345-abcde',
   *   privateKey: 'your-private-key-hex',
   * });
   * console.log('Status:', status.status);
   * if (status.result) {
   *   console.log('Output:', status.result.output);
   * }
   * ```
   */
  async queryInferenceTaskStatus(options: QueryTaskOptions): Promise<TaskStatusResponse> {
    const { taskId, privateKey } = options;
    
    // Get current timestamp in seconds
    const timestamp = Math.floor(Date.now() / 1000);
    
    // Create message to sign: "query_task:{task_id}:{timestamp}"
    const message = `query_task:${taskId}:${timestamp}`;
    
    // Hash the message using @noble/hashes (works in both Node.js and browser)
    const messageBytes = utf8ToBytes(message);
    const messageHashBytes = sha256(messageBytes);
    const messageHash = bytesToHex(messageHashBytes);
    
    // Sign the message hash
    const signature = signMessageHashRsv({ messageHash, privateKey });
    
    // Get public key from private key
    const publicKey = privateKeyToPublic(privateKey);
    const publicKeyHex = typeof publicKey === 'string' ? publicKey : bytesToHex(publicKey);
    
    // Build request body
    const requestBody: AuthenticatedTaskStatusRequest = {
      task_id: taskId,
      public_key: publicKeyHex,
      signature: signature,
      timestamp: timestamp,
    };

    const url = `${this.baseUrl}/api/v1/tasks/status`;
    const response = await this.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (response.status === 401) {
      throw new Error('Authentication failed: signature verification failed or request expired');
    }
    if (response.status === 403) {
      throw new Error('Forbidden: you are not the owner of this task');
    }
    if (response.status === 404) {
      throw new Error('Task not found');
    }

    const result: ApiResponse<TaskStatusResponse> = await response.json();
    if (result.success && result.data) {
      return result.data;
    } else {
      throw new Error(result.error || 'Failed to get inference task status');
    }
  }

  /**
   * Wait for an inference task to complete, polling periodically.
   * 
   * @param options - The task ID, private key, and optional polling settings
   * @returns A promise that resolves to the completed task status with result
   * 
   * @example
   * ```typescript
   * const api = new FunaiNodeApi({ baseUrl: 'http://localhost:8080' });
   * const result = await api.waitForInferenceResult({
   *   taskId: 'api-12345-abcde',
   *   privateKey: 'your-private-key-hex',
   *   pollIntervalMs: 2000,  // Poll every 2 seconds
   *   timeoutMs: 60000,      // Timeout after 60 seconds
   * });
   * console.log('Inference output:', result.result?.output);
   * ```
   */
  async waitForInferenceResult(options: QueryTaskOptions & {
    pollIntervalMs?: number;
    timeoutMs?: number;
  }): Promise<TaskStatusResponse> {
    const { taskId, privateKey, pollIntervalMs = 2000, timeoutMs = 300000 } = options;
    const startTime = Date.now();

    while (true) {
      const status = await this.queryInferenceTaskStatus({ taskId, privateKey });
      
      if (status.status === 'completed' || status.status === 'Completed') {
        return status;
      }
      
      if (status.status === 'failed' || status.status === 'Failed') {
        throw new Error(`Inference task failed: ${taskId}`);
      }
      
      if (status.status === 'timeout' || status.status === 'Timeout') {
        throw new Error(`Inference task timed out: ${taskId}`);
      }

      // Check if we've exceeded the timeout
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Timed out waiting for inference result after ${timeoutMs}ms`);
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }

  // ==================== Infer Node Staking Methods ====================

  /**
   * Query infer node stake info from on-chain contract
   * @param nodeAddress - The principal address of the infer node
   * @returns Stake info or null if not staked
   */
  async getInferStakeInfo(nodeAddress: string): Promise<InferStakeInfo | null> {
    const url = `${this.baseUrl}/v2/contracts/call-read/ST000000000000000000002AMW42H/pox-4/infer-get-stake-info`;
    
    const response = await this.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: nodeAddress,
        arguments: [`0x0516${nodeAddress.slice(2)}`], // principal CV
      }),
    });

    const result = await response.json();
    if (result.okay && result.result !== '0x09') { // 0x09 = none
      // Parse the result - this is a simplified version
      return {
        isStaked: true,
        rawResult: result.result,
      };
    }
    return null;
  }

  /**
   * Check if an infer node is staked
   * @param nodeAddress - The principal address of the infer node
   * @returns true if staked, false otherwise
   */
  async isInferNodeStaked(nodeAddress: string): Promise<boolean> {
    const info = await this.getInferStakeInfo(nodeAddress);
    return info !== null && info.isStaked;
  }

  /**
   * Create and broadcast a stake transaction for an inference node
   * Calls pox-4.infer-stake-stx on-chain
   * 
   * @param options - Staking options
   * @returns Transaction broadcast result
   */
  async stakeAsInferNode(options: InferStakeOptions): Promise<TxBroadcastResult> {
    // Build the contract call transaction
    const tx = await makeContractCall({
      contractAddress: 'ST000000000000000000002AMW42H', // Boot contract address
      contractName: 'pox-4',
      functionName: 'infer-stake-stx',
      functionArgs: [
        uintCV(options.amountUstx),           // amount-ustx
        uintCV(options.lockPeriod),           // lock-period (in blocks)
        stringAsciiCV(options.nodeId),        // node-id
      ],
      senderKey: options.senderKey,
      fee: options.fee,
      nonce: options.nonce,
      network: this.network,
    });

    // Broadcast the transaction
    return broadcastTransaction({ transaction: tx, network: this.network });
  }

  /**
   * Increase stake for an already-staked inference node
   * Calls pox-4.infer-increase-stake on-chain
   * 
   * @param options - Options for increasing stake
   * @returns Transaction broadcast result
   */
  async increaseInferStake(options: InferIncreaseStakeOptions): Promise<TxBroadcastResult> {
    const tx = await makeContractCall({
      contractAddress: 'ST000000000000000000002AMW42H',
      contractName: 'pox-4',
      functionName: 'infer-increase-stake',
      functionArgs: [
        uintCV(options.additionalAmountUstx),
      ],
      senderKey: options.senderKey,
      fee: options.fee,
      nonce: options.nonce,
      network: this.network,
    });

    return broadcastTransaction({ transaction: tx, network: this.network });
  }

  /**
   * Extend lock period for an already-staked inference node
   * Calls pox-4.infer-extend-lock on-chain
   * 
   * @param options - Options for extending lock
   * @returns Transaction broadcast result
   */
  async extendInferLock(options: InferExtendLockOptions): Promise<TxBroadcastResult> {
    const tx = await makeContractCall({
      contractAddress: 'ST000000000000000000002AMW42H',
      contractName: 'pox-4',
      functionName: 'infer-extend-lock',
      functionArgs: [
        uintCV(options.additionalPeriod),
      ],
      senderKey: options.senderKey,
      fee: options.fee,
      nonce: options.nonce,
      network: this.network,
    });

    return broadcastTransaction({ transaction: tx, network: this.network });
  }

  /**
   * Unlock staked STX after lock period expires
   * Calls pox-4.infer-unlock-stx on-chain
   * 
   * @param options - Unlock options
   * @returns Transaction broadcast result
   */
  async unlockInferStake(options: InferUnlockOptions): Promise<TxBroadcastResult> {
    const tx = await makeContractCall({
      contractAddress: 'ST000000000000000000002AMW42H',
      contractName: 'pox-4',
      functionName: 'infer-unlock-stx',
      functionArgs: [],
      senderKey: options.senderKey,
      fee: options.fee,
      nonce: options.nonce,
      network: this.network,
    });

    return broadcastTransaction({ transaction: tx, network: this.network });
  }
}

// Infer staking types
export interface InferStakeInfo {
  isStaked: boolean;
  rawResult: string;
  nodeId?: string;
  amountUstx?: bigint;
  lockStart?: number;
  lockPeriod?: number;
  unlockHeight?: number;
}

export interface InferStakeOptions {
  /** Amount to stake in micro-STX (1 STX = 1,000,000 uSTX) */
  amountUstx: bigint;
  /** Lock period in blocks (minimum 2100, maximum 52500) */
  lockPeriod: number;
  /** Unique node identifier */
  nodeId: string;
  /** Sender's private key */
  senderKey: string;
  /** Transaction fee in micro-STX */
  fee?: bigint;
  /** Transaction nonce */
  nonce?: bigint;
}

export interface InferIncreaseStakeOptions {
  /** Additional amount to stake in micro-STX */
  additionalAmountUstx: bigint;
  /** Sender's private key */
  senderKey: string;
  /** Transaction fee in micro-STX */
  fee?: bigint;
  /** Transaction nonce */
  nonce?: bigint;
}

export interface InferExtendLockOptions {
  /** Additional lock period in blocks */
  additionalPeriod: number;
  /** Sender's private key */
  senderKey: string;
  /** Transaction fee in micro-STX */
  fee?: bigint;
  /** Transaction nonce */
  nonce?: bigint;
}

export interface InferUnlockOptions {
  /** Sender's private key */
  senderKey: string;
  /** Transaction fee in micro-STX */
  fee?: bigint;
  /** Transaction nonce */
  nonce?: bigint;
}
