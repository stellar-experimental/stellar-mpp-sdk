




                     Machine Payments Protocol (MPP)
              Stellar Payment Method Specification

                        Draft Specification
                           March 2026


Abstract

   This document specifies the "stellar" payment method for the
   Machine Payments Protocol (MPP).  It defines how HTTP clients
   and servers negotiate, execute, and verify payments using
   Soroban Stellar Asset Contract (SAC) token transfers on the
   Stellar blockchain network.  The specification covers the
   challenge-response flow, credential formats, transaction
   construction, verification procedures, and optional fee
   sponsorship via Stellar FeeBumpTransactions.


Table of Contents

   1.  Introduction
   2.  Terminology
   3.  Method Registration
   4.  Protocol Overview
   5.  Challenge (Server → Client)
       5.1.  WWW-Authenticate Header Format
       5.2.  Payment Request Object
       5.3.  Method Details Object
   6.  Credential (Client → Server)
       6.1.  Authorization Header Format
       6.2.  Credential Payload Types
       6.3.  Transaction Credential (Pull Mode)
       6.4.  Signature Credential (Push Mode)
   7.  Verification (Server)
       7.1.  Pull Mode Verification
       7.2.  Push Mode Verification
       7.3.  SAC Transfer Verification
   8.  Receipt
   9.  Transaction Construction
       9.1.  SAC Transfer Invocation
       9.2.  Transaction Simulation
       9.3.  Signing
   10. Fee Sponsorship
       10.1. Server Configuration
       10.2. Challenge Advertisement
       10.3. FeeBumpTransaction Wrapping
   11. Replay Protection
   12. Networks and Constants
       12.1. Network Identifiers
       12.2. Well-Known SAC Addresses
       12.3. RPC Endpoints
       12.4. Default Parameters
   13. Error Handling
   14. Security Considerations
       14.1. Secret Key Handling
       14.2. Transaction Verification
       14.3. Replay Attacks
       14.4. Amount Validation
       14.5. Network Passphrase Binding
   15. IANA Considerations
   16. References
   Appendix A.  Example Exchange
   Appendix B.  JSON Schema Definitions


1.  Introduction

   The Machine Payments Protocol (MPP) [MPP] enables machine-to-
   machine payments over HTTP using the 402 Payment Required
   status code.  MPP is payment-method agnostic: it defines the
   HTTP-level challenge-response flow while delegating payment
   execution to method-specific plugins.

   This document defines the "stellar" payment method, which
   uses Soroban Stellar Asset Contract (SAC) token transfers
   on the Stellar network [STELLAR].  Soroban is Stellar's
   smart contract platform, and SAC contracts provide a standard
   interface for transferring Stellar-native and wrapped assets
   via the `transfer(from, to, amount)` function.

   The Stellar method supports two operational modes:

   -  Pull Mode (default): The client signs a transaction and
      sends the signed XDR to the server, which broadcasts it.
      This enables server-side fee sponsorship.

   -  Push Mode: The client broadcasts the transaction itself
      and sends the transaction hash to the server for on-chain
      verification.

   This specification is intended for implementors of MPP
   payment method plugins for the Stellar blockchain.


2.  Terminology

   The key words "MUST", "MUST NOT", "REQUIRED", "SHALL",
   "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY",
   and "OPTIONAL" in this document are to be interpreted as
   described in RFC 2119 [RFC2119].

   SAC:  Stellar Asset Contract.  A Soroban smart contract that
      wraps a Stellar asset (native XLM or issued assets like
      USDC) and exposes a standard token interface including
      `transfer(from, to, amount)`.

   Soroban:  Stellar's smart contract platform, which executes
      WebAssembly-based contracts on the Stellar network.

   Stroops:  The smallest unit of a Stellar asset.  1 unit =
      10^7 stroops (for 7-decimal assets).  Analogous to
      satoshis in Bitcoin or wei in Ethereum.

   XDR:  External Data Representation.  The binary encoding
      format used by Stellar for transactions and other
      protocol messages.

   Network Passphrase:  A string that uniquely identifies a
      Stellar network, used in transaction signing to prevent
      cross-network replay.

   FeeBumpTransaction:  A Stellar transaction type that wraps
      an inner transaction with a new fee, allowing a third
      party to pay the network fees.

   Challenge:  An MPP payment challenge sent by the server in
      the WWW-Authenticate header of a 402 response.

   Credential:  An MPP payment credential sent by the client
      in the Authorization header, proving payment was made.

   Receipt:  A server-issued confirmation that a payment was
      successfully verified.


3.  Method Registration

   Method Name:   stellar
   Intent:        charge
   Credential Payload Types:
      -  "transaction" (pull mode)
      -  "signature" (push mode)

   The method name "stellar" is registered with the MPP method
   registry.  The intent "charge" indicates a one-time payment
   (as opposed to subscriptions or pre-authorization).


4.  Protocol Overview

   The Stellar payment method follows the standard MPP
   challenge-response flow:

   Client                              Server
     |                                   |
     |  (1) GET /resource                |
     |---------------------------------->|
     |                                   |
     |  (2) 402 Payment Required         |
     |  WWW-Authenticate: Payment ...    |
     |  (challenge with amount,          |
     |   currency, recipient)            |
     |<----------------------------------|
     |                                   |
     |  (3) Build Soroban SAC transfer   |
     |  (4) Simulate via RPC             |
     |  (5) Sign transaction             |
     |                                   |
     |  (6) GET /resource                |
     |  Authorization: Payment ...       |
     |  (credential with signed XDR      |
     |   or tx hash)                     |
     |---------------------------------->|
     |                                   |
     |  (7) Verify credential            |
     |  (8) Broadcast tx (pull mode)     |
     |      or check on-chain (push)     |
     |                                   |
     |  (9) 200 OK + Receipt             |
     |<----------------------------------|

   Steps 3-5 are client-side operations.  In pull mode, the
   server performs step 8 (broadcast).  In push mode, the
   client broadcasts between steps 5 and 6, and the server
   verifies the on-chain result at step 8.


5.  Challenge (Server → Client)

5.1.  WWW-Authenticate Header Format

   When the server requires payment, it MUST respond with
   HTTP 402 Payment Required and include a WWW-Authenticate
   header using the "Payment" authentication scheme as defined
   by MPP [MPP]:

   WWW-Authenticate: Payment id="<challenge-id>",
     realm="MPP Payment",
     method="stellar",
     intent="charge",
     request="<base64-encoded-request>",
     description="<human-readable-description>",
     expires="<ISO-8601-timestamp>"

   The "request" parameter contains a base64-encoded JSON
   object as defined in Section 5.2.

5.2.  Payment Request Object

   The base64-decoded "request" parameter MUST be a JSON
   object with the following fields:

   +----------------+-----------+-----------------------------------+
   | Field          | Required  | Description                       |
   +----------------+-----------+-----------------------------------+
   | amount         | REQUIRED  | Payment amount in base units      |
   |                |           | (stroops).  String representation |
   |                |           | of a non-negative integer.        |
   | currency       | REQUIRED  | SAC contract address (C...) for   |
   |                |           | the token to transfer.            |
   | recipient      | REQUIRED  | Stellar public key (G...) or      |
   |                |           | contract address (C...) of the    |
   |                |           | payment recipient.                |
   | description    | OPTIONAL  | Human-readable description of     |
   |                |           | the payment purpose.              |
   | externalId     | OPTIONAL  | Merchant reconciliation ID (e.g., |
   |                |           | order ID, invoice number).        |
   | methodDetails  | OPTIONAL  | Method-specific details object    |
   |                |           | (see Section 5.3).                |
   +----------------+-----------+-----------------------------------+

   The amount MUST be expressed in base units (stroops).  For
   assets with 7 decimal places (the Stellar default), 1 unit
   equals 10,000,000 stroops.  For example, 0.01 USDC is
   represented as "100000".

   Conversion formula:

      base_units = floor(amount * 10^decimals)

5.3.  Method Details Object

   The methodDetails field, when present, MUST be a JSON object
   that MAY contain the following fields:

   +----------------+-----------+-----------------------------------+
   | Field          | Required  | Description                       |
   +----------------+-----------+-----------------------------------+
   | reference      | OPTIONAL  | Server-generated unique tracking  |
   |                |           | ID (UUID v4 RECOMMENDED).         |
   | network        | OPTIONAL  | Stellar network identifier.       |
   |                |           | MUST be "public" or "testnet".    |
   | memo           | OPTIONAL  | Text memo to attach to the        |
   |                |           | Stellar transaction.              |
   | feePayer       | OPTIONAL  | Boolean.  If true, the server     |
   |                |           | will sponsor transaction fees.    |
   | feePayerKey    | OPTIONAL  | Stellar public key (G...) of the  |
   |                |           | server's fee payer account.       |
   |                |           | Present only when feePayer=true.  |
   +----------------+-----------+-----------------------------------+

   The server SHOULD generate a unique "reference" for each
   challenge to enable idempotent verification and audit
   trailing.  UUID v4 is RECOMMENDED.

   When "network" is absent, clients SHOULD default to
   "testnet".


6.  Credential (Client → Server)

6.1.  Authorization Header Format

   After constructing and signing the payment transaction, the
   client MUST retry the original request with an Authorization
   header using the "Payment" scheme:

   Authorization: Payment <base64-encoded-credential>

   The credential is a base64-encoded JSON object containing:

   {
     "challenge": { <echo of the original challenge> },
     "payload": { <credential payload per Section 6.2> }
   }

6.2.  Credential Payload Types

   The credential payload is a discriminated union on the "type"
   field.  Two types are defined:

   +---------------+------+------------------------------------------+
   | Type          | Mode | Description                              |
   +---------------+------+------------------------------------------+
   | "transaction" | Pull | Contains signed transaction XDR for      |
   |               |      | server to broadcast.                     |
   | "signature"   | Push | Contains transaction hash of a           |
   |               |      | client-broadcast transaction.             |
   +---------------+------+------------------------------------------+

6.3.  Transaction Credential (Pull Mode)

   In pull mode, the client signs but does NOT broadcast the
   transaction.  The credential payload MUST have the form:

   {
     "type": "transaction",
     "xdr": "<base64-encoded-signed-transaction-envelope>"
   }

   The "xdr" field contains the complete signed Stellar
   transaction envelope in base64 XDR encoding, as produced
   by TransactionBuilder.toXDR().

   The transaction MUST:

   -  Contain exactly one invokeHostFunction operation
   -  Invoke the SAC `transfer(from, to, amount)` function
   -  Target the contract address specified in the challenge
      "currency" field
   -  Transfer to the address specified in the challenge
      "recipient" field
   -  Transfer the exact amount specified in the challenge
      "amount" field
   -  Be signed by the source account (the payer)
   -  Include Soroban resource data (from simulation)

   The transaction MAY include a text memo if specified in
   the challenge methodDetails.

6.4.  Signature Credential (Push Mode)

   In push mode, the client broadcasts the transaction and
   waits for confirmation before sending the credential.
   The credential payload MUST have the form:

   {
     "type": "signature",
     "hash": "<64-character-hex-transaction-hash>"
   }

   The transaction hash MUST correspond to a successful
   transaction on the Stellar network specified in the
   challenge.  The client SHOULD poll getTransaction until
   status is "SUCCESS" before sending the credential.


7.  Verification (Server)

7.1.  Pull Mode Verification

   Upon receiving a "transaction" credential, the server
   MUST perform the following verification steps:

   1.  Deserialize the XDR using TransactionBuilder.fromXDR()
       with the expected network passphrase.

   2.  If the transaction is a FeeBumpTransaction, extract the
       inner transaction for verification.

   3.  Verify the SAC transfer invocation per Section 7.3.

   4.  If fee sponsorship is configured and the transaction
       is not already fee-bumped, wrap it in a
       FeeBumpTransaction (see Section 10).

   5.  Broadcast the transaction via Soroban RPC
       sendTransaction.

   6.  Poll getTransaction until the status is no longer
       "NOT_FOUND".

   7.  If status is "SUCCESS", return a Receipt.  Otherwise,
       return an error.

7.2.  Push Mode Verification

   Upon receiving a "signature" credential, the server MUST:

   1.  Look up the transaction using the provided hash via
       Soroban RPC getTransaction.

   2.  If status is "NOT_FOUND", poll up to 10 times with
       1-second intervals.

   3.  If status is "SUCCESS", extract the transaction
       envelope and verify the SAC transfer per Section 7.3.

   4.  If verification passes, return a Receipt.

   5.  If status is not "SUCCESS" after polling, return an
       error.

7.3.  SAC Transfer Verification

   To verify a SAC transfer invocation, the server MUST
   inspect the transaction's operations and confirm:

   1.  The transaction contains at least one
       invokeHostFunction operation.

   2.  The host function type is
       hostFunctionTypeInvokeContract.

   3.  The invoked contract address matches the expected
       "currency" (SAC contract address).

   4.  The invoked function name is "transfer".

   5.  The function has at least 3 arguments:
       a.  args[0]: from (Address) — the payer
       b.  args[1]: to (Address) — MUST match the expected
           "recipient"
       c.  args[2]: amount (Int128/Int64/Int32) — MUST match
           the expected "amount" in base units

   The amount argument MAY be encoded as any of the following
   Soroban ScVal integer types: scvI128, scvU128, scvI64,
   scvU64, scvI32, scvU32.  Implementations MUST support all
   six types.


8.  Receipt

   Upon successful verification, the server MUST issue an MPP
   receipt with the following fields:

   {
     "method": "stellar",
     "reference": "<transaction-hash>",
     "status": "success",
     "timestamp": "<ISO-8601-timestamp>"
   }

   The "reference" field MUST be the Stellar transaction hash,
   which serves as a unique, on-chain proof of payment.


9.  Transaction Construction

   This section describes how clients MUST construct the SAC
   transfer transaction.

9.1.  SAC Transfer Invocation

   The client constructs a Soroban contract invocation:

   Contract: <challenge.currency>   (SAC contract address)
   Function: "transfer"
   Arguments:
     [0] from:   Address(client_public_key)  → ScVal(Address)
     [1] to:     Address(challenge.recipient) → ScVal(Address)
     [2] amount: BigInt(challenge.amount)     → ScVal(I128)

   The amount SHOULD be encoded as I128 using nativeToScVal
   with type "i128" for maximum compatibility.

9.2.  Transaction Simulation

   Before signing, the client MUST simulate the transaction
   using the Soroban RPC prepareTransaction method.  This:

   -  Attaches the required Soroban resource footprint
   -  Calculates the resource fee
   -  Validates the transaction will succeed

   If simulation fails, the client MUST NOT sign or submit
   the transaction.

9.3.  Signing

   The client signs the prepared transaction using its
   Ed25519 keypair corresponding to the source account.
   The signing process uses the network passphrase to
   prevent cross-network replay.


10.  Fee Sponsorship

10.1.  Server Configuration

   Servers MAY configure a fee payer account to sponsor
   transaction fees for clients.  This is useful for
   onboarding users who may not hold XLM for fees.

   The fee payer is specified as a Stellar Keypair or
   secret key string in the server's charge configuration.

10.2.  Challenge Advertisement

   When fee sponsorship is enabled, the server MUST include
   the following fields in the challenge's methodDetails:

   {
     "feePayer": true,
     "feePayerKey": "<fee-payer-public-key>"
   }

   This informs the client that the server will pay the
   network fees.  The client MAY use this information for
   display purposes but MUST NOT alter its transaction
   construction process.

10.3.  FeeBumpTransaction Wrapping

   In pull mode, after verifying the client's signed
   transaction (Section 7.1, step 3), the server:

   1.  MUST check if the transaction is already a
       FeeBumpTransaction.  If so, skip wrapping.

   2.  Constructs a FeeBumpTransaction using:
       -  Fee payer: the server's fee payer keypair
       -  Fee: the inner transaction fee multiplied by 10
          (providing a generous buffer)
       -  Inner transaction: the client's signed transaction
       -  Network passphrase: the configured network

   3.  Signs the FeeBumpTransaction with the fee payer
       keypair.

   4.  Broadcasts the FeeBumpTransaction instead of the
       inner transaction.

   Fee sponsorship is NOT applicable in push mode, as the
   client broadcasts the transaction directly.


11.  Replay Protection

   Servers SHOULD implement replay protection to prevent
   challenge reuse.  The RECOMMENDED approach:

   1.  Before processing a credential, generate a unique
       store key: "stellar:challenge:<challenge-id>"

   2.  Check the store for an existing entry.  If found,
       reject the credential with "Challenge already used.
       Replay rejected."

   3.  After successful verification, store the challenge
       ID with the usage timestamp.

   The store implementation is not specified by this
   document.  Implementations MAY use in-memory stores,
   Redis, Cloudflare KV, Upstash, or any key-value store.


12.  Networks and Constants

12.1.  Network Identifiers

   +----------+-----------------------------------------------+
   | ID       | Network Passphrase                            |
   +----------+-----------------------------------------------+
   | public   | "Public Global Stellar Network ; September    |
   |          |  2015"                                        |
   | testnet  | "Test SDF Network ; September 2015"           |
   +----------+-----------------------------------------------+

12.2.  Well-Known SAC Addresses

   The following SAC contract addresses are registered for
   common assets:

   +--------+---------+------------------------------------------+
   | Asset  | Network | SAC Contract Address (C...)               |
   +--------+---------+------------------------------------------+
   | USDC   | public  | CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZ  |
   |        |         | PUTHXSTZLEO7SJMI                         |
   | USDC   | testnet | CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WW |
   |        |         | FEIE3USCIHMXQDAMA                        |
   | XLM    | public  | CAS3J7GYLGVE45MR3HPSFG352DAANEV5GGMFTO3 |
   |        |         | IZIE4JMCDALQO57Y                         |
   | XLM    | testnet | CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2 |
   |        |         | FB2RMQQVU2HHGCYSC                        |
   +--------+---------+------------------------------------------+

   Implementations SHOULD use these addresses when
   referencing common assets.  Other SAC addresses MAY be
   used for additional assets.

12.3.  RPC Endpoints

   +----------+----------------------------------------------+
   | Network  | Soroban RPC URL                              |
   +----------+----------------------------------------------+
   | public   | https://soroban-rpc.mainnet.stellar.gateway.fm |
   | testnet  | https://soroban-testnet.stellar.org           |
   +----------+----------------------------------------------+

   +----------+----------------------------------------------+
   | Network  | Horizon URL                                  |
   +----------+----------------------------------------------+
   | public   | https://horizon.stellar.org                  |
   | testnet  | https://horizon-testnet.stellar.org          |
   +----------+----------------------------------------------+

   Implementations MAY use alternative RPC endpoints.

12.4.  Default Parameters

   +-------------------+---------+---------------------------------+
   | Parameter         | Default | Description                     |
   +-------------------+---------+---------------------------------+
   | decimals          | 7       | Decimal places for amount       |
   |                   |         | conversion.                     |
   | fee               | "100"   | Base fee in stroops.            |
   | timeout           | 180     | Transaction timeout in seconds. |
   | network           | testnet | Default network identifier.     |
   | mode              | pull    | Default credential mode.        |
   | getTransaction    | 10      | Max polling attempts for push   |
   |   maxAttempts     |         | mode verification.              |
   | getTransaction    | 1000    | Polling interval in             |
   |   intervalMs      |         | milliseconds.                   |
   +-------------------+---------+---------------------------------+


13.  Error Handling

   The Stellar method uses the standard MPP error response
   format (RFC 9457 Problem Details) with the following
   specific error conditions:

   +-----------------------------+--------+------------------------+
   | Condition                   | Status | Problem Type URI       |
   +-----------------------------+--------+------------------------+
   | No payment provided         | 402    | .../payment-required   |
   | Challenge expired           | 402    | .../payment-expired    |
   | Invalid credential format   | 402    | .../verification-failed|
   | SAC transfer mismatch       | 402    | .../verification-failed|
   | Transaction failed on-chain | 402    | .../verification-failed|
   | Challenge replay detected   | 402    | .../verification-failed|
   | Unsupported credential type | 402    | .../verification-failed|
   +-----------------------------+--------+------------------------+

   Error detail messages SHOULD include specific information
   about the failure to aid debugging:

   -  "Transaction does not contain a Soroban invocation."
   -  "Transaction does not contain a matching SAC transfer
       invocation."
   -  "Transaction <hash> is not successful (status: FAILED)."
   -  "Challenge already used. Replay rejected."
   -  "Unsupported credential type \"<type>\"."


14.  Security Considerations

14.1.  Secret Key Handling

   Client secret keys (S...) MUST be handled securely:

   -  MUST NOT be transmitted over the network.
   -  MUST NOT be logged or included in error messages.
   -  SHOULD be stored in environment variables or secure
      key management systems, not in source code.
   -  MUST be used only for transaction signing on the
      client side.

   Server fee payer keys (when configured) are subject to
   the same requirements.

14.2.  Transaction Verification

   Servers MUST verify ALL of the following before accepting
   a payment credential:

   -  Contract address matches the expected currency
   -  Recipient address matches the expected recipient
   -  Amount matches the expected amount exactly
   -  Function name is "transfer"
   -  Transaction is on the correct network (via passphrase)

   Servers MUST NOT accept transactions that only partially
   match (e.g., correct amount but wrong recipient).

14.3.  Replay Attacks

   Without replay protection (Section 11), a client could
   reuse a valid credential to access the resource multiple
   times with a single payment.  Servers SHOULD implement
   challenge-based replay protection.

   The Stellar network itself prevents transaction replay
   via sequence numbers, but MPP challenges can be replayed
   at the application layer.

14.4.  Amount Validation

   Servers MUST convert human-readable amounts to base units
   (stroops) using integer arithmetic to avoid floating-point
   precision errors.

   The conversion MUST be:

      stroops = integer(amount * 10^decimals)

   Servers MUST verify the exact stroop amount, not an
   approximate floating-point comparison.

14.5.  Network Passphrase Binding

   The Stellar network passphrase is included in the
   transaction hash, preventing cross-network replay.
   Servers MUST verify transactions against the expected
   network passphrase.  A transaction signed for testnet
   MUST NOT be accepted by a server expecting mainnet
   payments, and vice versa.


15.  IANA Considerations

   This document registers the following MPP payment method:

   Method Name:  stellar
   Specification:  This document
   Contact:  Stellar Development Foundation


16.  References

   [MPP]      Machine Payments Protocol, https://mpp.dev

   [STELLAR]  Stellar Development Foundation, "Stellar
              Documentation", https://developers.stellar.org

   [SOROBAN]  Stellar Development Foundation, "Soroban
              Documentation",
              https://soroban.stellar.org

   [SAC]      Stellar Development Foundation, "Stellar Asset
              Contract",
              https://developers.stellar.org/docs/tokens/
              stellar-asset-contract

   [RFC2119]  Bradner, S., "Key words for use in RFCs to
              Indicate Requirement Levels", BCP 14,
              RFC 2119, March 1997.

   [RFC9457]  Nottingham, M., Wilde, E., and S. Dalal,
              "Problem Details for HTTP APIs", RFC 9457,
              July 2023.

   [XDR]      Stellar Development Foundation, "XDR: External
              Data Representation",
              https://developers.stellar.org/docs/learn/
              encyclopedia/data-format/xdr


Appendix A.  Example Exchange

   A.1.  Challenge (402 Response)

   HTTP/1.1 402 Payment Required
   Content-Type: application/problem+json
   Cache-Control: no-store
   WWW-Authenticate: Payment id="abc123",
     realm="MPP Payment",
     method="stellar",
     intent="charge",
     request="eyJhbW91bnQiOiIxMDAwMDAiLCJjdXJyZW5jeSI6IkNCSU
       VMVEs2WUJaSlU1VVAyV1dRRVVDWUtMUFU2QVVOWjJCUTRXV0ZF
       SUUzVVNDSUhNWFFEQU1BIiwibWV0aG9kRGV0YWlscyI6eyJuZX
       R3b3JrIjoidGVzdG5ldCIsInJlZmVyZW5jZSI6IjU5MDRhMGE3
       LTlhZGUtNGQ2Yy05YjZiLTU4ZWRjNmUxNTk2NCJ9LCJyZWNpcG
       llbnQiOiJHQzZaQkNJNk02UE1CTVJDWlFNT0dDVU9aS0ZSRU03
       UDZHMk5DM1RENUZNWVgzWUxQQUFDUU1KWSJ9",
     description="Premium API access",
     expires="2026-03-19T00:00:00Z"

   {
     "type": "https://paymentauth.org/problems/payment-required",
     "title": "Payment Required",
     "status": 402,
     "detail": "Payment is required (Premium API access)."
   }

   Decoded request:

   {
     "amount": "100000",
     "currency": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WW...",
     "methodDetails": {
       "network": "testnet",
       "reference": "5904a0a7-9ade-4d6c-9b6b-58edc6e15964"
     },
     "recipient": "GC6ZBCI6M6PMBMRCZQMOGCUOZKFREM7P6G2NC..."
   }

   A.2.  Credential (Retry with Authorization)

   GET /resource HTTP/1.1
   Host: api.example.com
   Authorization: Payment eyJjaGFsbGVuZ2UiOnsi...

   Decoded credential:

   {
     "challenge": { ... },
     "payload": {
       "type": "transaction",
       "xdr": "AAAAAgAAAADZ2ARaaH3..."
     }
   }

   A.3.  Success Response

   HTTP/1.1 200 OK
   Content-Type: application/json
   X-Payment-Receipt: eyJtZXRob2QiOiJzdGVsbGFyIi...

   {
     "message": "Payment verified — here is your premium content.",
     "timestamp": "2026-03-19T00:00:05Z"
   }


Appendix B.  JSON Schema Definitions

   B.1.  Payment Request Schema

   {
     "$schema": "https://json-schema.org/draft/2020-12/schema",
     "type": "object",
     "required": ["amount", "currency", "recipient"],
     "properties": {
       "amount": {
         "type": "string",
         "pattern": "^[0-9]+$",
         "description": "Payment amount in base units (stroops)"
       },
       "currency": {
         "type": "string",
         "pattern": "^C[A-Z2-7]{55}$",
         "description": "SAC contract address"
       },
       "recipient": {
         "type": "string",
         "pattern": "^[GC][A-Z2-7]{55}$",
         "description": "Recipient Stellar address"
       },
       "description": {
         "type": "string"
       },
       "externalId": {
         "type": "string"
       },
       "methodDetails": {
         "type": "object",
         "properties": {
           "reference": { "type": "string", "format": "uuid" },
           "network": { "enum": ["public", "testnet"] },
           "memo": { "type": "string", "maxLength": 28 },
           "feePayer": { "type": "boolean" },
           "feePayerKey": {
             "type": "string",
             "pattern": "^G[A-Z2-7]{55}$"
           }
         }
       }
     }
   }

   B.2.  Credential Payload Schema

   {
     "$schema": "https://json-schema.org/draft/2020-12/schema",
     "discriminator": { "propertyName": "type" },
     "oneOf": [
       {
         "type": "object",
         "required": ["type", "xdr"],
         "properties": {
           "type": { "const": "transaction" },
           "xdr": {
             "type": "string",
             "description": "Base64-encoded signed transaction XDR"
           }
         }
       },
       {
         "type": "object",
         "required": ["type", "hash"],
         "properties": {
           "type": { "const": "signature" },
           "hash": {
             "type": "string",
             "pattern": "^[a-f0-9]{64}$",
             "description": "Transaction hash (hex)"
           }
         }
       }
     ]
   }

   B.3.  Receipt Schema

   {
     "$schema": "https://json-schema.org/draft/2020-12/schema",
     "type": "object",
     "required": ["method", "reference", "status", "timestamp"],
     "properties": {
       "method": { "const": "stellar" },
       "reference": {
         "type": "string",
         "description": "Stellar transaction hash"
       },
       "status": { "const": "success" },
       "timestamp": {
         "type": "string",
         "format": "date-time"
       }
     }
   }


Authors' Addresses

   Stellar Development Foundation
   https://stellar.org
