import { IntegerType, PrivateKey, PublicKey } from '@funai/common';
import {
  NetworkClientParam,
  FUNAI_MAINNET,
  clientFromNetwork,
  networkFrom,
} from '@funai/network';
import { c32address } from 'c32check';
import {
  SpendingCondition,
  createMultiSigSpendingCondition,
  createSingleSigSpendingCondition,
  createSponsoredAuth,
  createStandardAuth,
  isSingleSig,
} from './authorization';
import { ClarityValue, PrincipalCV } from './clarity';
import {
  AddressHashMode,
  ClarityVersion,
  MultiSigHashMode,
  PayloadType,
  PostConditionMode,
  SingleSigHashMode,
} from './constants';
import { ClarityAbi, validateContractCall } from './contract-abi';
import { fetchAbi, fetchFeeEstimate, fetchNonce } from './fetch';
import {
  createFunaiPublicKey,
  privateKeyToHex,
  privateKeyToPublic,
  publicKeyToAddress,
  publicKeyToHex,
} from './keys';
import { postConditionModeFrom, postConditionToWire } from './postcondition';
import { PostCondition, PostConditionModeName } from './postcondition-types';
import { TransactionSigner } from './signer';
import { FunaiTransactionWire, deriveNetworkFromTx } from './transaction';
import { omit } from './utils';
import {
  PostConditionWire,
  addressFromPublicKeys,
  createAddress,
  createContractCallPayload,
  createLPList,
  createSmartContractPayload,
  createTokenTransferPayload, createInferPayload, createRegisterModelPayload,
} from './wire';

/** @deprecated Not used internally */
export interface MultiSigOptions {
  numSignatures: number;
  publicKeys: string[];
  signerKeys?: string[];
}

export interface UnsignedMultiSigOptions {
  /** The minimum required signatures N (in a N of M multi-sig) */
  numSignatures: number;
  /** The M public-keys (in a N of M multi-sig), which together form the address of the multi-sig account */
  publicKeys: PublicKey[];
  /**
   * The `address` of the multi-sig account.
   * - If NOT provided, the public-key order is taken AS IS.
   * - If provided, the address will be checked against the order of the public-keys (either AS IS or SORTED).
   * The default is to SORT the public-keys (only if the `address` is provided).
   */
  address?: string;
  /** @experimental Use newer non-sequential multi-sig hashmode for transaction. Future releases may make this the default. */
  useNonSequentialMultiSig?: boolean;
}

export type SignedMultiSigOptions = UnsignedMultiSigOptions & {
  signerKeys: PrivateKey[];
};

/**
 * Funai token transfer transaction options
 *
 * Note: Standard Funai transfer does not allow post-conditions.
 */
export type TokenTransferOptions = {
  /** the address of the recipient of the token transfer */
  recipient: string | PrincipalCV;
  /** the amount to be transfered in ufunai */
  amount: IntegerType;
  /** the transaction fee in ufunai */
  fee?: IntegerType;
  /** the transaction nonce, which must be increased monotonically with each new transaction */
  nonce?: IntegerType;
  /** an arbitrary string to include in the transaction, must be less than 34 bytes */
  memo?: string;
  /** set to true if another account is sponsoring the transaction (covering the transaction fee) */
  sponsored?: boolean;
} & NetworkClientParam;

export interface UnsignedTokenTransferOptions extends TokenTransferOptions {
  publicKey: PublicKey;
}

export interface SignedTokenTransferOptions extends TokenTransferOptions {
  senderKey: PrivateKey;
}

export type InferOptions = {
  /** the address of the sender of the infer tx */
  inferUserAddress: string;
  /** the amount to be transfered */
  amount: IntegerType;
  /** the input of the infer tx */
  userInput: string;
  /** the context of the infer tx */
  context: string;

  /** the model name */
  modelName: string;
  /** the transaction fee in ufunai */
  fee?: IntegerType;
  /** the transaction nonce, which must be increased monotonically with each new transaction */
  nonce?: IntegerType;
  /** set to true if another account is sponsoring the transaction (covering the transaction fee) */
  sponsored?: boolean;
} & NetworkClientParam;

export interface UnsignedInferOptions extends InferOptions {
  publicKey: PublicKey;
}

export interface SignedInferOptions extends InferOptions {
  senderKey: PrivateKey;
}

export type RegisterModelOptions = {
  /** the model name */
  modelName: string;
  /** the model parameters */
  modelParams: string;
  /** the transaction fee in ufunai */
  fee?: IntegerType;
  /** the transaction nonce, which must be increased monotonically with each new transaction */
  nonce?: IntegerType;
  /** set to true if another account is sponsoring the transaction (covering the transaction fee) */
  sponsored?: boolean;
} & NetworkClientParam;

export interface UnsignedRegisterModelOptions extends RegisterModelOptions {
  publicKey: PublicKey;
}

export interface SignedRegisterModelOptions extends RegisterModelOptions {
  senderKey: PrivateKey;
}

export type UnsignedMultiSigTokenTransferOptions = TokenTransferOptions & UnsignedMultiSigOptions;

export type SignedMultiSigTokenTransferOptions = TokenTransferOptions & SignedMultiSigOptions;

export async function makeUnsignedInfer(
  txOptions: UnsignedInferOptions
): Promise<FunaiTransactionWire> {
  const defaultOptions = {
    fee: BigInt(0),
    nonce: BigInt(0),
    network: FUNAI_MAINNET,
  };

  const options = Object.assign(defaultOptions, txOptions);
  options.network = networkFrom(options.network);
  options.client = Object.assign({}, clientFromNetwork(options.network), txOptions.client);

  const payload = createInferPayload(
    options.inferUserAddress,
    options.amount,
    options.userInput,
    options.context,
    "ST000000000000000000002AMW42H", // Null principal for assignment by signer
    options.modelName
  );

  let spendingCondition: SpendingCondition | null = null;

  if ('publicKey' in options) {
    // single-sig
    spendingCondition = createSingleSigSpendingCondition(
      AddressHashMode.P2PKH,
      options.publicKey,
      options.nonce,
      options.fee
    );
  } else {
    // multi-sig
    // TODO: implement multi-sig infer
    return Promise.reject('Multi-sig infer not yet implemented');
  }

  const authorization = options.sponsored
    ? createSponsoredAuth(spendingCondition)
    : createStandardAuth(spendingCondition);

  const transaction = new FunaiTransactionWire({
    transactionVersion: options.network.transactionVersion,
    chainId: options.network.chainId,
    auth: authorization,
    payload,
    // no post conditions on Funai infer (see SIP-005)
  });

  if (txOptions.fee == null) {
    const fee = await fetchFeeEstimate({ transaction, ...options });
    transaction.setFee(fee);
  }

  if (txOptions.nonce == null) {
    const addressVersion = options.network.addressVersion.singleSig;
    const address = c32address(addressVersion, transaction.auth.spendingCondition!.signer);
    const txNonce = await fetchNonce({ address, ...options });
    transaction.setNonce(txNonce);
  }

  return transaction;
}


export async function makeInfer(txOptions: SignedInferOptions): Promise<FunaiTransactionWire> {
  if ('senderKey' in txOptions) {
    // single-sig
    const publicKey = privateKeyToPublic(txOptions.senderKey);
    const options = omit(txOptions, 'senderKey');
    const transaction = await makeUnsignedInfer({ publicKey, ...options });

    const privKey = txOptions.senderKey;
    const signer = new TransactionSigner(transaction);
    signer.signOrigin(privKey);

    return transaction;
  } else {
    // multi-sig
    // TODO: implement multi-sig infer
    return Promise.reject('Multi-sig infer not yet implemented');
  }
}

export async function makeUnsignedRegisterModel(
  txOptions: UnsignedRegisterModelOptions
): Promise<FunaiTransactionWire> {
  const defaultOptions = {
    fee: BigInt(0),
    nonce: BigInt(0),
    network: FUNAI_MAINNET,
  };

  const options = Object.assign(defaultOptions, txOptions);
  options.network = networkFrom(options.network);
  options.client = Object.assign({}, clientFromNetwork(options.network), txOptions.client);

  const payload = createRegisterModelPayload(
    options.modelName,
    options.modelParams
  );

  let spendingCondition: SpendingCondition | null = null;

  if ('publicKey' in options) {
    // single-sig
    spendingCondition = createSingleSigSpendingCondition(
      AddressHashMode.P2PKH,
      options.publicKey,
      options.nonce,
      options.fee
    );
  } else {
    // multi-sig
    return Promise.reject('Multi-sig register-model not yet implemented');
  }

  const authorization = options.sponsored
    ? createSponsoredAuth(spendingCondition)
    : createStandardAuth(spendingCondition);

  const transaction = new FunaiTransactionWire({
    transactionVersion: options.network.transactionVersion,
    chainId: options.network.chainId,
    auth: authorization,
    payload,
  });

  if (txOptions.fee == null) {
    const fee = await fetchFeeEstimate({ transaction, ...options });
    transaction.setFee(fee);
  }

  if (txOptions.nonce == null) {
    const addressVersion = options.network.addressVersion.singleSig;
    const address = c32address(addressVersion, transaction.auth.spendingCondition!.signer);
    const txNonce = await fetchNonce({ address, ...options });
    transaction.setNonce(txNonce);
  }

  return transaction;
}

export async function makeRegisterModel(txOptions: SignedRegisterModelOptions): Promise<FunaiTransactionWire> {
  if ('senderKey' in txOptions) {
    // single-sig
    const publicKey = privateKeyToPublic(txOptions.senderKey);
    const options = omit(txOptions, 'senderKey');
    const transaction = await makeUnsignedRegisterModel({ publicKey, ...options });

    const privKey = txOptions.senderKey;
    const signer = new TransactionSigner(transaction);
    signer.signOrigin(privKey);

    return transaction;
  } else {
    // multi-sig
    return Promise.reject('Multi-sig register-model not yet implemented');
  }
}

/**
 * Generates an unsigned Funai token transfer transaction
 *
 * Returns a Funai token transfer transaction.
 *
 * @param {UnsignedTokenTransferOptions | UnsignedMultiSigTokenTransferOptions} txOptions - an options object for the token transfer
 *
 * @return {Promise<FunaiTransactionWire>}
 */
export async function makeUnsignedFunaiTokenTransfer(
  txOptions: UnsignedTokenTransferOptions | UnsignedMultiSigTokenTransferOptions
): Promise<FunaiTransactionWire> {
  const defaultOptions = {
    fee: BigInt(0),
    nonce: BigInt(0),
    network: FUNAI_MAINNET,
    memo: '',
    sponsored: false,
  };

  const options = Object.assign(defaultOptions, txOptions);
  options.network = networkFrom(options.network);
  options.client = Object.assign({}, clientFromNetwork(options.network), txOptions.client);

  const payload = createTokenTransferPayload(options.recipient, options.amount, options.memo);

  let spendingCondition: SpendingCondition | null = null;

  if ('publicKey' in options) {
    // single-sig
    spendingCondition = createSingleSigSpendingCondition(
      AddressHashMode.P2PKH,
      options.publicKey,
      options.nonce,
      options.fee
    );
  } else {
    // multi-sig
    const hashMode = options.useNonSequentialMultiSig
      ? AddressHashMode.P2SHNonSequential
      : AddressHashMode.P2SH;

    const publicKeys = options.address
      ? sortPublicKeysForAddress(
          options.publicKeys.map(publicKeyToHex),
          options.numSignatures,
          hashMode,
          createAddress(options.address).hash160
        )
      : options.publicKeys.map(publicKeyToHex);

    spendingCondition = createMultiSigSpendingCondition(
      hashMode,
      options.numSignatures,
      publicKeys,
      options.nonce,
      options.fee
    );
  }

  const authorization = options.sponsored
    ? createSponsoredAuth(spendingCondition)
    : createStandardAuth(spendingCondition);

  const transaction = new FunaiTransactionWire({
    transactionVersion: options.network.transactionVersion,
    chainId: options.network.chainId,
    auth: authorization,
    payload,
    // no post conditions on Funai transfers (see SIP-005)
  });

  if (txOptions.fee == null) {
    const fee = await fetchFeeEstimate({ transaction, ...options });
    transaction.setFee(fee);
  }

  if (txOptions.nonce == null) {
    const addressVersion = options.network.addressVersion.singleSig;
    const address = c32address(addressVersion, transaction.auth.spendingCondition!.signer);
    const txNonce = await fetchNonce({ address, ...options });
    transaction.setNonce(txNonce);
  }

  return transaction;
}

/**
 * Generates a signed Funai token transfer transaction
 *
 * Returns a signed Funai token transfer transaction.
 *
 * @param {SignedTokenTransferOptions | SignedMultiSigTokenTransferOptions} txOptions - an options object for the token transfer
 *
 * @return {FunaiTransactionWire}
 */
export async function makeFunaiTokenTransfer(
  txOptions: SignedTokenTransferOptions | SignedMultiSigTokenTransferOptions
): Promise<FunaiTransactionWire> {
  if ('senderKey' in txOptions) {
    // single-sig
    const publicKey = privateKeyToPublic(txOptions.senderKey);
    const options = omit(txOptions, 'senderKey');
    const transaction = await makeUnsignedFunaiTokenTransfer({ publicKey, ...options });

    const privKey = txOptions.senderKey;
    const signer = new TransactionSigner(transaction);
    signer.signOrigin(privKey);

    return transaction;
  } else {
    // multi-sig
    const options = omit(txOptions, 'signerKeys');
    const transaction = await makeUnsignedFunaiTokenTransfer(options);

    mutatingSignAppendMultiSig(
      transaction,
      txOptions.publicKeys.map(publicKeyToHex).slice(),
      txOptions.signerKeys.map(privateKeyToHex),
      txOptions.address
    );

    return transaction;
  }
}

/**
 * Contract deploy transaction options
 */
export type BaseContractDeployOptions = {
  clarityVersion?: ClarityVersion;
  contractName: string;
  /** the Clarity code to be deployed */
  codeBody: string;
  /** transaction fee in ufunai */
  fee?: IntegerType;
  /** the transaction nonce, which must be increased monotonically with each new transaction */
  nonce?: IntegerType;
  /** the post condition mode, specifying whether or not post-conditions must fully cover all
   * transfered assets */
  postConditionMode?: PostConditionModeName | PostConditionMode;
  /** a list of post conditions to add to the transaction */
  postConditions?: PostCondition[] | PostConditionWire[];
  /** set to true if another account is sponsoring the transaction (covering the transaction fee) */
  sponsored?: boolean;
} & NetworkClientParam;

export interface UnsignedContractDeployOptions extends BaseContractDeployOptions {
  /** a hex string of the public key of the transaction sender */
  publicKey: PublicKey;
}

export interface SignedContractDeployOptions extends BaseContractDeployOptions {
  senderKey: PrivateKey;
}

/** @deprecated Use {@link SignedContractDeployOptions} or {@link UnsignedContractDeployOptions} instead. */
export interface ContractDeployOptions extends SignedContractDeployOptions {}

export type UnsignedMultiSigContractDeployOptions = BaseContractDeployOptions &
  UnsignedMultiSigOptions;

export type SignedMultiSigContractDeployOptions = BaseContractDeployOptions & SignedMultiSigOptions;

/**
 * Generates a Clarity smart contract deploy transaction
 *
 * @param {SignedContractDeployOptions | SignedMultiSigContractDeployOptions} txOptions - an options object for the contract deploy
 *
 * Returns a signed Funai smart contract deploy transaction.
 *
 * @return {FunaiTransactionWire}
 */
export async function makeContractDeploy(
  txOptions: SignedContractDeployOptions | SignedMultiSigContractDeployOptions
): Promise<FunaiTransactionWire> {
  if ('senderKey' in txOptions) {
    // single-sig
    const publicKey = privateKeyToPublic(txOptions.senderKey);
    const options = omit(txOptions, 'senderKey');
    const transaction = await makeUnsignedContractDeploy({ publicKey, ...options });

    const privKey = txOptions.senderKey;
    const signer = new TransactionSigner(transaction);
    signer.signOrigin(privKey);

    return transaction;
  } else {
    // multi-sig
    const options = omit(txOptions, 'signerKeys');
    const transaction = await makeUnsignedContractDeploy(options);

    mutatingSignAppendMultiSig(
      transaction,
      txOptions.publicKeys.map(publicKeyToHex).slice(),
      txOptions.signerKeys.map(privateKeyToHex),
      txOptions.address
    );

    return transaction;
  }
}

export async function makeUnsignedContractDeploy(
  txOptions: UnsignedContractDeployOptions | UnsignedMultiSigContractDeployOptions
): Promise<FunaiTransactionWire> {
  const defaultOptions = {
    fee: BigInt(0),
    nonce: BigInt(0),
    network: FUNAI_MAINNET,
    postConditionMode: PostConditionMode.Deny,
    sponsored: false,
    clarityVersion: ClarityVersion.Clarity3,
  };

  const options = Object.assign(defaultOptions, txOptions);
  options.network = networkFrom(options.network);
  options.client = Object.assign({}, clientFromNetwork(options.network), txOptions.client);
  options.postConditionMode = postConditionModeFrom(options.postConditionMode);

  const payload = createSmartContractPayload(
    options.contractName,
    options.codeBody,
    options.clarityVersion
  );

  let spendingCondition: SpendingCondition | null = null;

  if ('publicKey' in options) {
    // single-sig
    spendingCondition = createSingleSigSpendingCondition(
      AddressHashMode.P2PKH,
      options.publicKey,
      options.nonce,
      options.fee
    );
  } else {
    // multi-sig
    const hashMode = options.useNonSequentialMultiSig
      ? AddressHashMode.P2SHNonSequential
      : AddressHashMode.P2SH;

    const publicKeys = options.address
      ? sortPublicKeysForAddress(
          options.publicKeys.map(publicKeyToHex),
          options.numSignatures,
          hashMode,
          createAddress(options.address).hash160
        )
      : options.publicKeys.map(publicKeyToHex);

    spendingCondition = createMultiSigSpendingCondition(
      hashMode,
      options.numSignatures,
      publicKeys,
      options.nonce,
      options.fee
    );
  }

  const authorization = options.sponsored
    ? createSponsoredAuth(spendingCondition)
    : createStandardAuth(spendingCondition);

  const postConditions: PostConditionWire[] = (options.postConditions ?? []).map(pc => {
    if (typeof pc.type === 'string') return postConditionToWire(pc);
    return pc;
  });
  const lpPostConditions = createLPList(postConditions);

  const transaction = new FunaiTransactionWire({
    transactionVersion: options.network.transactionVersion,
    chainId: options.network.chainId,
    auth: authorization,
    payload,
    postConditions: lpPostConditions,
    postConditionMode: options.postConditionMode,
  });

  if (txOptions.fee === undefined || txOptions.fee === null) {
    const fee = await fetchFeeEstimate({ transaction, ...options });
    transaction.setFee(fee);
  }

  if (txOptions.nonce === undefined || txOptions.nonce === null) {
    const addressVersion = options.network.addressVersion.singleSig;
    const address = c32address(addressVersion, transaction.auth.spendingCondition!.signer);
    const txNonce = await fetchNonce({ address, ...options });
    transaction.setNonce(txNonce);
  }

  return transaction;
}

/**
 * Contract function call transaction options
 */
export type ContractCallOptions = {
  /** the Funai address of the contract */
  contractAddress: string;
  contractName: string;
  functionName: string;
  functionArgs: ClarityValue[];
  /** transaction fee in ufunai */
  fee?: IntegerType;
  /** the transaction nonce, which must be increased monotonically with each new transaction */
  nonce?: IntegerType;
  /** the post condition mode, specifying whether or not post-conditions must fully cover all
   * transfered assets */
  postConditionMode?: PostConditionModeName | PostConditionMode;
  /** a list of post conditions to add to the transaction */
  postConditions?: PostCondition[];
  /** set to true to validate that the supplied function args match those specified in
   * the published contract */
  validateWithAbi?: boolean | ClarityAbi;
  /** set to true if another account is sponsoring the transaction (covering the transaction fee) */
  sponsored?: boolean;
} & NetworkClientParam;

export interface UnsignedContractCallOptions extends ContractCallOptions {
  publicKey: PrivateKey;
}

export interface SignedContractCallOptions extends ContractCallOptions {
  senderKey: PublicKey;
}

export type UnsignedMultiSigContractCallOptions = ContractCallOptions & UnsignedMultiSigOptions;

export type SignedMultiSigContractCallOptions = ContractCallOptions & SignedMultiSigOptions;

/**
 * Generates an unsigned Clarity smart contract function call transaction
 *
 * @param {UnsignedContractCallOptions | UnsignedMultiSigContractCallOptions} txOptions - an options object for the contract call
 *
 * @returns {Promise<FunaiTransactionWire>}
 */
export async function makeUnsignedContractCall(
  txOptions: UnsignedContractCallOptions | UnsignedMultiSigContractCallOptions
): Promise<FunaiTransactionWire> {
  const defaultOptions = {
    fee: BigInt(0),
    nonce: BigInt(0),
    network: FUNAI_MAINNET,
    postConditionMode: PostConditionMode.Deny,
    sponsored: false,
  };

  const options = Object.assign(defaultOptions, txOptions);
  options.network = networkFrom(options.network);
  options.client = Object.assign({}, clientFromNetwork(options.network), options.client);
  options.postConditionMode = postConditionModeFrom(options.postConditionMode);

  const payload = createContractCallPayload(
    options.contractAddress,
    options.contractName,
    options.functionName,
    options.functionArgs
  );

  if (options?.validateWithAbi) {
    let abi: ClarityAbi;
    if (typeof options.validateWithAbi === 'boolean') {
      if (options?.network) {
        abi = await fetchAbi({ ...options });
      } else {
        throw new Error('Network option must be provided in order to validate with ABI');
      }
    } else {
      abi = options.validateWithAbi;
    }

    validateContractCall(payload, abi);
  }

  let spendingCondition: SpendingCondition | null = null;

  if ('publicKey' in options) {
    // single-sig
    spendingCondition = createSingleSigSpendingCondition(
      AddressHashMode.P2PKH,
      options.publicKey,
      options.nonce,
      options.fee
    );
  } else {
    // multi-sig
    const hashMode = options.useNonSequentialMultiSig
      ? AddressHashMode.P2SHNonSequential
      : AddressHashMode.P2SH;

    const publicKeys = options.address
      ? sortPublicKeysForAddress(
          options.publicKeys.map(publicKeyToHex),
          options.numSignatures,
          hashMode,
          createAddress(options.address).hash160
        )
      : options.publicKeys.map(publicKeyToHex);

    spendingCondition = createMultiSigSpendingCondition(
      hashMode,
      options.numSignatures,
      publicKeys,
      options.nonce,
      options.fee
    );
  }

  const authorization = options.sponsored
    ? createSponsoredAuth(spendingCondition)
    : createStandardAuth(spendingCondition);

  const postConditions: PostConditionWire[] = (options.postConditions ?? []).map(pc => {
    if (typeof pc.type === 'string') return postConditionToWire(pc);
    return pc;
  });
  const lpPostConditions = createLPList(postConditions);

  const transaction = new FunaiTransactionWire({
    transactionVersion: options.network.transactionVersion,
    chainId: options.network.chainId,
    auth: authorization,
    payload,
    postConditions: lpPostConditions,
    postConditionMode: options.postConditionMode,
  });

  if (txOptions.fee === undefined || txOptions.fee === null) {
    const fee = await fetchFeeEstimate({ transaction, ...options });
    transaction.setFee(fee);
  }

  if (txOptions.nonce === undefined || txOptions.nonce === null) {
    const addressVersion = options.network.addressVersion.singleSig;
    const address = c32address(addressVersion, transaction.auth.spendingCondition!.signer);
    const txNonce = await fetchNonce({ address, ...options });
    transaction.setNonce(txNonce);
  }

  return transaction;
}

/**
 * Generates a Clarity smart contract function call transaction
 *
 * @param {SignedContractCallOptions | SignedMultiSigContractCallOptions} txOptions - an options object for the contract function call
 *
 * Returns a signed Funai smart contract function call transaction.
 *
 * @return {FunaiTransactionWire}
 */
export async function makeContractCall(
  txOptions: SignedContractCallOptions | SignedMultiSigContractCallOptions
): Promise<FunaiTransactionWire> {
  if ('senderKey' in txOptions) {
    // single-sig
    const publicKey = privateKeyToPublic(txOptions.senderKey);
    const options = omit(txOptions, 'senderKey');
    const transaction = await makeUnsignedContractCall({ publicKey, ...options });

    const privKey = txOptions.senderKey;
    const signer = new TransactionSigner(transaction);
    signer.signOrigin(privKey);

    return transaction;
  } else {
    // multi-sig
    const options = omit(txOptions, 'signerKeys');
    const transaction = await makeUnsignedContractCall(options);

    mutatingSignAppendMultiSig(
      transaction,
      txOptions.publicKeys.map(publicKeyToHex).slice(),
      txOptions.signerKeys.map(privateKeyToHex),
      txOptions.address
    );

    return transaction;
  }
}

/**
 * Sponsored transaction options
 */
export type SponsorOptionsOpts = {
  /** the origin-signed transaction */
  transaction: FunaiTransactionWire;
  /** the sponsor's private key */
  sponsorPrivateKey: PrivateKey;
  /** the transaction fee amount to sponsor */
  fee?: IntegerType;
  /** the nonce of the sponsor account */
  sponsorNonce?: IntegerType;
  /** the hashmode of the sponsor's address */
  sponsorAddressHashmode?: AddressHashMode;
} & NetworkClientParam;

/**
 * Constructs and signs a sponsored transaction as the sponsor
 *
 * @param {SponsorOptionsOpts} sponsorOptions - the sponsor options object
 *
 * Returns a signed sponsored transaction.
 *
 * @return {ClarityValue}
 */
export async function sponsorTransaction(
  sponsorOptions: SponsorOptionsOpts
): Promise<FunaiTransactionWire> {
  const defaultOptions = {
    fee: 0 as IntegerType,
    sponsorNonce: 0 as IntegerType,
    sponsorAddressHashmode: AddressHashMode.P2PKH as SingleSigHashMode,
    network: deriveNetworkFromTx(sponsorOptions.transaction),
  };

  const options = Object.assign(defaultOptions, sponsorOptions);
  options.network = networkFrom(options.network);
  options.client = Object.assign({}, clientFromNetwork(options.network), options.client);

  const sponsorPubKey = privateKeyToPublic(options.sponsorPrivateKey);

  if (sponsorOptions.fee == null) {
    let txFee: bigint | number = 0;
    switch (options.transaction.payload.payloadType) {
      case PayloadType.TokenTransfer:
      case PayloadType.SmartContract:
      case PayloadType.VersionedSmartContract:
      case PayloadType.ContractCall:
        txFee = BigInt(await fetchFeeEstimate({ ...options }));
        break;
      default:
        throw new Error(
          `Sponsored transactions not supported for transaction type ${
            PayloadType[options.transaction.payload.payloadType]
          }`
        );
    }
    options.transaction.setFee(txFee);
    options.fee = txFee;
  }

  if (sponsorOptions.sponsorNonce == null) {
    const addressVersion = options.network.addressVersion.singleSig;
    const address = publicKeyToAddress(addressVersion, sponsorPubKey);
    const sponsorNonce = await fetchNonce({ address, ...options });
    options.sponsorNonce = sponsorNonce;
  }

  const sponsorSpendingCondition = createSingleSigSpendingCondition(
    options.sponsorAddressHashmode,
    sponsorPubKey,
    options.sponsorNonce,
    options.fee
  );

  options.transaction.setSponsor(sponsorSpendingCondition);

  const privKey = options.sponsorPrivateKey;
  const signer = TransactionSigner.createSponsorSigner(
    options.transaction,
    sponsorSpendingCondition
  );
  signer.signSponsor(privKey);

  return signer.transaction;
}

/** @internal multi-sig signing re-use */
function mutatingSignAppendMultiSig(
  /** **Warning:** method mutates `transaction` */
  transaction: FunaiTransactionWire,
  publicKeys: string[],
  signerKeys: string[],
  address?: string
) {
  if (isSingleSig(transaction.auth.spendingCondition)) {
    throw new Error('Transaction is not a multi-sig transaction');
  }

  const signer = new TransactionSigner(transaction);

  const pubs = address
    ? sortPublicKeysForAddress(
        publicKeys,
        transaction.auth.spendingCondition.signaturesRequired,
        transaction.auth.spendingCondition.hashMode,
        createAddress(address).hash160
      )
    : publicKeys;

  // sign in order of public keys
  for (const publicKey of pubs) {
    const signerKey = signerKeys.find(key => privateKeyToPublic(key) === publicKey);
    if (signerKey) {
      // either sign and append message signature (which allows for recovering the public key)
      signer.signOrigin(signerKey);
    } else {
      // or append the public key (which did not sign here)
      signer.appendOrigin(publicKey);
    }
  }
}

/** @internal Get the matching public-keys array for a multi-sig address */
function sortPublicKeysForAddress(
  publicKeys: string[],
  numSigs: number,
  hashMode: MultiSigHashMode,
  hash: string
): string[] {
  // unsorted
  const hashUnsorted = addressFromPublicKeys(
    0 as any, // only used for hash, so version doesn't matter
    hashMode,
    numSigs,
    publicKeys.map(createFunaiPublicKey)
  ).hash160;

  if (hashUnsorted === hash) return publicKeys;

  // sorted
  const publicKeysSorted = publicKeys.slice().sort();
  const hashSorted = addressFromPublicKeys(
    0 as any, // only used for hash, so version doesn't matter
    hashMode,
    numSigs,
    publicKeysSorted.map(createFunaiPublicKey)
  ).hash160;

  if (hashSorted === hash) return publicKeysSorted;

  throw new Error('Failed to find matching multi-sig address given public-keys.');
}
