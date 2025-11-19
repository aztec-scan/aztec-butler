import SafeApiKitDefault from "@safe-global/api-kit";
import SafeDefault from "@safe-global/protocol-kit";
import type { MetaTransactionData } from "@safe-global/types-kit";
import { OperationType } from "@safe-global/types-kit";
import { privateKeyToAccount } from "viem/accounts";

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
   * Propose a transaction to the Safe multisig
   * Creates a Safe transaction, signs it with the proposer, and submits to Safe Transaction Service
   */
  async proposeTransaction(proposal: MultisigProposal): Promise<void> {
    try {
      console.log("[SafeGlobalClient] Starting transaction proposal...");

      // Initialize Protocol Kit if not already done
      await this.initProtocolKit();

      if (!this.protocolKit) {
        throw new Error("Protocol Kit initialization failed");
      }

      // Create Safe transaction data
      const safeTransactionData: MetaTransactionData = {
        to: proposal.to,
        value: proposal.value || "0",
        data: proposal.data,
        operation: (proposal.operation || 0) as OperationType,
      };

      console.log("[SafeGlobalClient] Creating Safe transaction...");

      // Create the Safe transaction
      const safeTransaction = await this.protocolKit.createTransaction({
        transactions: [safeTransactionData],
      });

      console.log("[SafeGlobalClient] Generating transaction hash...");

      // Get transaction hash
      const safeTxHash =
        await this.protocolKit.getTransactionHash(safeTransaction);

      console.log("[SafeGlobalClient] Transaction hash:", safeTxHash);
      console.log("[SafeGlobalClient] Signing transaction with proposer...");

      // Sign the transaction hash with the proposer's key
      const signature = await this.protocolKit.signHash(safeTxHash);

      console.log(
        "[SafeGlobalClient] Submitting proposal to Safe Transaction Service...",
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
      console.error("[SafeGlobalClient] Error proposing transaction:", error);
      throw error;
    }
  }
}
