import SafeApiKitDefault from "@safe-global/api-kit";
import SafeDefault from "@safe-global/protocol-kit";
import type {
  MetaTransactionData,
  SafeMultisigTransactionResponse,
} from "@safe-global/types-kit";
import { OperationType } from "@safe-global/types-kit";
import { privateKeyToAccount } from "viem/accounts";

const GET_PENDING_TRANSACTION_POLL_DELAY = 45_000;

// Get the actual class constructors from the default exports
const SafeApiKit = SafeApiKitDefault.default || SafeApiKitDefault;
const Safe = SafeDefault.default || SafeDefault;

export interface SafeGlobalClientConfig {
  safeAddress: string;
  chainId: number;
  rpcUrl: string;
  proposerPrivateKey: string;
  safeApiKey: string;
}

export interface MultisigProposal {
  to: string;
  data: string;
  value?: string; // Changed from bigint to string for consistency with Safe SDK
  operation?: number; // 0 = CALL, 1 = DELEGATECALL
}

/**
 * Client for interacting with Safe Global multisig
 * Handles transaction proposals and status checking
 */
export class SafeGlobalClient {
  private config: SafeGlobalClientConfig;
  private apiKit: InstanceType<typeof SafeApiKit>;
  private protocolKit: Awaited<ReturnType<typeof Safe.init>> | null = null;
  private proposerAddress: string;
  private pendingTransactions: SafeMultisigTransactionResponse[] = [];
  private pendingTransactionPoller: NodeJS.Timeout | null = null;

  // Queue to serialize proposals (prevents nonce conflicts)
  private proposalQueue: Promise<void> = Promise.resolve();

  // Tracks txs this process is currently proposing (burst de-dupe)
  private inFlightKeys = new Set<string>();

  private senderPreflightChecked = false;

  private senderPreflightRole: "owner" | "delegate" | "unknown" = "unknown";

  private extractErrorDetails(error: unknown): string[] {
    const details: string[] = [];

    if (error instanceof Error) {
      details.push(`message=${error.message}`);
    }

    if (typeof error === "object" && error !== null) {
      const maybeError = error as Record<string, unknown>;
      const candidateFields = [
        "detail",
        "details",
        "data",
        "message",
        "nonFieldErrors",
        "non_field_errors",
        "reason",
        "response",
      ];

      for (const field of candidateFields) {
        const value = maybeError[field];
        if (value === undefined || value === null) {
          continue;
        }

        if (typeof value === "string") {
          details.push(`${field}=${value}`);
          continue;
        }

        if (Array.isArray(value)) {
          const joined = value
            .map((entry) =>
              typeof entry === "string" ? entry : JSON.stringify(entry),
            )
            .join(" | ");
          details.push(`${field}=${joined}`);
          continue;
        }

        details.push(`${field}=${JSON.stringify(value)}`);
      }
    }

    return details;
  }

  private formatProposalContextError(
    proposal: MultisigProposal,
    context: {
      nonce?: string;
      safeTxHash?: string;
      signatureLength?: number;
    },
    error: unknown,
  ): Error {
    const value = proposal.value || "0";
    const calldataBytes = proposal.data.startsWith("0x")
      ? (proposal.data.length - 2) / 2
      : Math.ceil(proposal.data.length / 2);
    const details = this.extractErrorDetails(error);
    const detailsText =
      details.length > 0 ? `\n  API details: ${details.join(" ; ")}` : "";

    const message =
      "Safe proposal failed." +
      `\n  chainId=${this.config.chainId}` +
      `\n  safeAddress=${this.config.safeAddress}` +
      `\n  senderAddress=${this.proposerAddress}` +
      `\n  to=${proposal.to}` +
      `\n  value=${value}` +
      `\n  operation=${proposal.operation || 0}` +
      `\n  calldataBytes=${calldataBytes}` +
      (context.nonce !== undefined ? `\n  nonce=${context.nonce}` : "") +
      (context.safeTxHash ? `\n  safeTxHash=${context.safeTxHash}` : "") +
      (context.signatureLength !== undefined
        ? `\n  signatureLength=${context.signatureLength}`
        : "") +
      detailsText +
      "\n  Hint: verify sender is an owner/delegate of this Safe and the tx-service supports this chain/safe pair.";

    return new Error(message);
  }

  private async runSenderPreflightCheck(): Promise<void> {
    if (this.senderPreflightChecked) {
      return;
    }

    console.log("[SafeGlobalClient] Running sender preflight checks...");

    const senderLower = this.proposerAddress.toLowerCase();
    const safeInfo = await this.apiKit.getSafeInfo(this.config.safeAddress);
    const owners = Array.isArray((safeInfo as any).owners)
      ? (safeInfo as any).owners.map((owner: string) => owner.toLowerCase())
      : [];

    const isOwner = owners.includes(senderLower);

    let delegates: string[] = [];
    try {
      const delegatesResponse = (await this.apiKit.getSafeDelegates({
        safeAddress: this.config.safeAddress,
        limit: 100,
        offset: 0,
      })) as {
        results?: Array<{ delegate?: string }>;
      };

      if (Array.isArray(delegatesResponse.results)) {
        delegates = delegatesResponse.results
          .map((entry) => (entry.delegate ? entry.delegate.toLowerCase() : ""))
          .filter((value) => value !== "");
      }
    } catch (error) {
      console.warn(
        "[SafeGlobalClient] Could not fetch delegates during preflight:",
        error,
      );
    }

    const isDelegate = delegates.includes(senderLower);

    if (!isOwner && !isDelegate) {
      throw new Error(
        "Safe sender preflight failed. " +
          `sender=${this.proposerAddress} is neither owner nor delegate for safe=${this.config.safeAddress}. ` +
          `ownersCount=${owners.length} delegatesCount=${delegates.length}. ` +
          "If this address is only a UI proposer, use an owner key or register it as a Safe delegate in tx-service.",
      );
    }

    this.senderPreflightRole = isOwner ? "owner" : "delegate";
    this.senderPreflightChecked = true;
    console.log(
      `[SafeGlobalClient] Sender preflight OK: ${this.proposerAddress} recognized as ${this.senderPreflightRole}`,
    );
  }

  constructor(config: SafeGlobalClientConfig) {
    this.config = config;

    // Derive proposer address from private key
    const account = privateKeyToAccount(
      this.config.proposerPrivateKey as `0x${string}`,
    );
    this.proposerAddress = account.address;

    // Initialize API Kit
    this.apiKit = new SafeApiKit({
      chainId: BigInt(this.config.chainId),
      apiKey: this.config.safeApiKey,
    });

    void this.getPendingTransactions().catch(console.error);
  }

  /**
   * Initialize the Protocol Kit (Safe SDK)
   * Called lazily on first proposeTransaction
   */
  private async initProtocolKit(): Promise<void> {
    if (this.protocolKit) {
      return;
    }

    console.log(
      "[SafeGlobalClient] Initializing Protocol Kit for Safe:",
      this.config.safeAddress,
    );

    this.protocolKit = await Safe.init({
      provider: this.config.rpcUrl,
      signer: this.config.proposerPrivateKey,
      safeAddress: this.config.safeAddress,
    });

    console.log("[SafeGlobalClient] Protocol Kit initialized successfully");
  }

  /**
   * fetch currently pending transactions from the safe wallet
   */
  private async getPendingTransactions(): Promise<void> {
    console.log("[SafeGlobalClient] fetching pending transactions");
    this.pendingTransactions = (
      await this.apiKit.getPendingTransactions(this.config.safeAddress)
    ).results;
    console.log(
      `[SafeGlobalClient] ${this.pendingTransactions.length} transactions pending`,
    );
  }

  public startPendingTransactionsPoll(): void {
    if (this.pendingTransactionPoller) {
      console.log("[SafeGlobalClient] poller already running");
      return;
    }
    console.log("[SafeGlobalClient] starting pending transactions poller");
    this.pendingTransactionPoller = setInterval(() => {
      void this.getPendingTransactions().catch(console.error);
    }, GET_PENDING_TRANSACTION_POLL_DELAY);
  }

  public cancelPendingTransactionsPoll(): void {
    if (this.pendingTransactionPoller) {
      clearInterval(this.pendingTransactionPoller);
      this.pendingTransactionPoller = null;
      console.log("[SafeGlobalClient] stopped pending transactions poller");
    }
  }

  /**
   * Build a key used to detect duplicates (both in-flight and pending)
   */
  private makeKey(to: string, value: string, data: string): string {
    return `${to.toLowerCase()}|${value}|${data}`;
  }

  /**
   * Checks whether a transaction with similar data or values is already proposed
   * If there is an outgoing transaction to that to address with any eth value
   * If there is an outgoing transaction with that exact same calldata already
   */
  private isBeingProposed(proposal: MultisigProposal): boolean {
    const { to, value = "0", data } = proposal;

    const key = this.makeKey(to, value, data);

    //Check in-flight txs in this process (covers bursts)
    if (this.inFlightKeys.has(key)) {
      return true;
    }

    const isPending = this.pendingTransactions.some((pending) => {
      const sameToAndValueIsSet = pending.to === to && pending.value !== "0";
      const sameCalldata =
        data !== "0x" && pending.data !== "0x" && pending.data === data;

      return sameToAndValueIsSet || sameCalldata;
    });

    return isPending;
  }

  /**
   * Public API: propose a transaction, but ensure proposals
   * are processed sequentially to avoid nonce conflicts.
   */
  async proposeTransaction(proposal: MultisigProposal): Promise<void> {
    // Ensure queue keeps flowing even if previous tasks failed
    this.proposalQueue = this.proposalQueue
      .catch((err) => {
        console.error(
          "[SafeGlobalClient] Previous proposal in queue failed:",
          err,
        );
      })
      .then(async () => {
        await new Promise((res) => setTimeout(res, 500)); // 500ms
        await this._proposeTransactionInternal(proposal);
      });

    return this.proposalQueue;
  }

  /**
   * Internal implementation that actually talks to Safe.
   * This is always called via the queue above.
   */
  private async _proposeTransactionInternal(
    proposal: MultisigProposal,
  ): Promise<void> {
    let nextNonce: string | undefined;
    let safeTxHash: string | undefined;
    let signatureLength: number | undefined;

    try {
      console.log("[SafeGlobalClient] Starting transaction proposal...");

      // Initialize Protocol Kit if not already done
      await this.initProtocolKit();

      if (!this.protocolKit) {
        throw new Error("Protocol Kit initialization failed");
      }

      await this.runSenderPreflightCheck();

      // check if a similar transaction is already being proposed
      if (this.isBeingProposed(proposal)) {
        console.log(
          "[SafeGlobalClient] Similar transaction already proposed in wallet",
        );
        return;
      }

      // Create Safe transaction data
      const safeTransactionData: MetaTransactionData = {
        to: proposal.to,
        value: proposal.value || "0",
        data: proposal.data,
        operation: (proposal.operation || 0) as OperationType,
      };

      console.log("[SafeGlobalClient] Creating Safe transaction...");
      nextNonce = await this.apiKit.getNextNonce(this.config.safeAddress);
      console.log(
        "[SafeGlobalClient] Creating Safe transaction with nonce:",
        nextNonce,
      );

      // Create the Safe transaction
      const safeTransaction = await this.protocolKit.createTransaction({
        transactions: [safeTransactionData],
        options: {
          nonce: Number(nextNonce),
        },
      });

      console.log("[SafeGlobalClient] Generating transaction hash...");

      // Get transaction hash
      safeTxHash = await this.protocolKit.getTransactionHash(safeTransaction);

      console.log("[SafeGlobalClient] Transaction hash:", safeTxHash);
      console.log("[SafeGlobalClient] Signing transaction with proposer...");

      // Sign the transaction hash with the proposer's key
      const signature = await this.protocolKit.signHash(safeTxHash);
      signatureLength = signature.data.length;

      console.log(
        "[SafeGlobalClient] Submitting proposal to Safe Transaction Service...",
      );

      console.log(
        `[SafeGlobalClient] Proposing safe transaction ${proposal.to} ${proposal.value} ${proposal.data}`,
      );

      // Propose transaction to the Safe Transaction Service
      await this.apiKit.proposeTransaction({
        safeAddress: this.config.safeAddress,
        safeTransactionData: safeTransaction.data,
        safeTxHash,
        senderAddress: this.proposerAddress,
        senderSignature: signature.data,
        origin: "aztec-butler automatic proposal",
      });

      console.log("[SafeGlobalClient] ✓ Transaction proposed successfully!");
      console.log("[SafeGlobalClient] Safe TX Hash:", safeTxHash);
    } catch (error) {
      const context: {
        nonce?: string;
        safeTxHash?: string;
        signatureLength?: number;
      } = {};

      if (nextNonce !== undefined) {
        context.nonce = nextNonce;
      }
      if (safeTxHash !== undefined) {
        context.safeTxHash = safeTxHash;
      }
      if (signatureLength !== undefined) {
        context.signatureLength = signatureLength;
      }

      const formattedError = this.formatProposalContextError(
        proposal,
        context,
        error,
      );
      console.error(
        "[SafeGlobalClient] Error proposing transaction:",
        formattedError.message,
      );
      throw formattedError;
    }
  }
}
