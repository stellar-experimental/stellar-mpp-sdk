---
title: Stellar Charge Intent for HTTP Payment Authentication
abbrev: Stellar Charge
docname: draft-stellar-charge-00
version: "00"
category: info
ipr: noModificationTrust200902
submissiontype: IETF
consensus: true

author:
  - name: Sagar Patil
    ins: S. Patil
    email: sagar.patil@stellar.org
    organization: Stellar Development Foundation

normative:
  RFC2119:
  RFC3339:
  RFC4648:
  RFC8174:
  RFC8259:
  RFC8785:
  RFC9457:
  I-D.httpauth-payment:
    title: "The 'Payment' HTTP Authentication Scheme"
    target: https://datatracker.ietf.org/doc/draft-httpauth-payment/
    author:
      - name: Jake Moxey
    date: 2026-01

informative:
  STELLAR:
    title: "Stellar Documentation"
    target: https://developers.stellar.org
    author:
      - org: Stellar Development Foundation
  SOROBAN:
    title: "Soroban Documentation"
    target: https://soroban.stellar.org
    author:
      - org: Stellar Development Foundation
  SAC:
    title: "Stellar Asset Contract"
    target: https://developers.stellar.org/docs/tokens/stellar-asset-contract
    author:
      - org: Stellar Development Foundation
  XDR-FORMAT:
    title: "XDR: External Data Representation"
    target: https://developers.stellar.org/docs/learn/encyclopedia/data-format/xdr
    author:
      - org: Stellar Development Foundation
---

--- abstract

This document specifies the "stellar" payment method for the
Machine Payments Protocol (MPP). It defines how HTTP clients
and servers negotiate, execute, and verify payments using
Soroban Stellar Asset Contract (SAC) token transfers on the
Stellar blockchain network. The specification covers the
challenge-response flow, credential formats, transaction
construction, verification procedures, and optional fee
sponsorship via Stellar FeeBumpTransactions.

--- middle

# Introduction

The Machine Payments Protocol (MPP) {{I-D.httpauth-payment}}
enables machine-to-machine payments over HTTP using the
402 Payment Required status code. MPP is payment-method
agnostic: it defines the HTTP-level challenge-response flow
while delegating payment execution to method-specific plugins.

This document defines the "stellar" payment method, which
uses Soroban Stellar Asset Contract (SAC) token transfers
on the Stellar network {{STELLAR}}. Soroban is Stellar's
smart contract platform, and SAC contracts provide a standard
interface for transferring Stellar-native and wrapped assets
via the `transfer(from, to, amount)` function.

The Stellar method supports two operational modes:

- **Pull Mode** (default): The client signs a transaction and
  sends the signed XDR to the server, which broadcasts it.
  This enables server-side fee sponsorship.

- **Push Mode**: The client broadcasts the transaction itself
  and sends the transaction hash to the server for on-chain
  verification.

This specification is intended for implementors of MPP
payment method plugins for the Stellar blockchain.

# Requirements Language

{::boilerplate bcp14-tagged}

# Terminology

SAC
: Stellar Asset Contract. A Soroban smart contract that
  wraps a Stellar asset (native XLM or issued assets like
  USDC) and exposes a standard token interface including
  `transfer(from, to, amount)`.

Soroban
: Stellar's smart contract platform, which executes
  WebAssembly-based contracts on the Stellar network.

Stroops
: The smallest unit of a Stellar asset. 1 unit =
  10^7 stroops (for 7-decimal assets). Analogous to
  satoshis in Bitcoin or wei in Ethereum.

XDR
: External Data Representation {{XDR-FORMAT}}. The binary
  encoding format used by Stellar for transactions and
  other protocol messages.

Network Passphrase
: A string that uniquely identifies a Stellar network,
  used in transaction signing to prevent cross-network
  replay.

FeeBumpTransaction
: A Stellar transaction type that wraps an inner
  transaction with a new fee, allowing a third party
  to pay the network fees.

# Method Registration

| Property | Value |
|----------|-------|
| **Method Name** | `stellar` |
| **Intent** | `charge` |
| **Credential Payload Types** | `"transaction"` (pull mode), `"signature"` (push mode) |

The method name "stellar" is registered with the MPP method
registry. The intent "charge" indicates a one-time payment
(as opposed to subscriptions or pre-authorization).

# Protocol Overview

The Stellar payment method follows the standard MPP
challenge-response flow:

~~~
  Client                           Server
    |                                |
    |  (1) GET /resource             |
    |------------------------------->|
    |                                |
    |  (2) 402 Payment Required      |
    |  WWW-Authenticate: Payment ... |
    |  (challenge with amount,       |
    |   currency, recipient)         |
    |<-------------------------------|
    |                                |
    |  (3) Build Soroban SAC transfer|
    |  (4) Simulate via RPC          |
    |  (5) Sign transaction          |
    |                                |
    |  (6) GET /resource             |
    |  Authorization: Payment ...    |
    |  (credential with signed XDR   |
    |   or tx hash)                  |
    |------------------------------->|
    |                                |
    |  (7) Verify credential         |
    |  (8) Broadcast tx (pull mode)  |
    |      or check on-chain (push)  |
    |                                |
    |  (9) 200 OK + Receipt          |
    |<-------------------------------|
    |                                |
~~~

Steps 3-5 are client-side operations. In pull mode, the
server performs step 8 (broadcast). In push mode, the
client broadcasts between steps 5 and 6, and the server
verifies the on-chain result at step 8.

# Request Schema {#request-schema}

The `request` parameter in the `WWW-Authenticate` challenge
contains a base64url-encoded JSON object. The JSON MUST be
serialized using JSON Canonicalization Scheme (JCS)
{{RFC8785}} before base64url encoding, per
{{I-D.httpauth-payment}}.

## WWW-Authenticate Header Format

When the server requires payment, it MUST respond with
HTTP 402 Payment Required and include a `WWW-Authenticate`
header using the "Payment" authentication scheme as defined
by {{I-D.httpauth-payment}}:

~~~http
WWW-Authenticate: Payment id="<challenge-id>",
  realm="MPP Payment",
  method="stellar",
  intent="charge",
  request="<base64url-encoded-request>",
  description="<human-readable-description>",
  expires="<ISO-8601-timestamp>"
~~~

The "request" parameter contains a base64url-encoded JSON
object as defined in {{shared-fields}}.

## Shared Fields {#shared-fields}

The base64url-decoded "request" parameter MUST be a JSON
object with the following fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | string | REQUIRED | Payment amount in base units (stroops). String representation of a non-negative integer. |
| `currency` | string | REQUIRED | SAC contract address (`C...`) for the token to transfer. |
| `recipient` | string | REQUIRED | Stellar public key (`G...`) or contract address (`C...`) of the payment recipient. |
| `description` | string | OPTIONAL | Human-readable description of the payment purpose. |
| `externalId` | string | OPTIONAL | Merchant's reference (order ID, invoice number, etc.) |
| `methodDetails` | object | OPTIONAL | Method-specific details object (see {{method-details}}). |

Challenge expiry is conveyed by the `expires` auth-param in
`WWW-Authenticate` per {{I-D.httpauth-payment}}, using
{{RFC3339}} format. Request objects MUST NOT duplicate the
expiry value.

The amount MUST be expressed in base units (stroops). For
assets with 7 decimal places (the Stellar default), 1 unit
equals 10,000,000 stroops. For example, 0.01 USDC is
represented as `"100000"`.

Conversion formula:

    base_units = floor(amount * 10^decimals)

## Method Details {#method-details}

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `methodDetails.reference` | string | OPTIONAL | Server-generated unique tracking ID (UUID v4 RECOMMENDED). |
| `methodDetails.network` | string | OPTIONAL | Stellar network identifier. MUST be `"public"` or `"testnet"`. |
| `methodDetails.memo` | string | OPTIONAL | Text memo to attach to the Stellar transaction. Maximum 28 characters. |
| `methodDetails.feePayer` | boolean | OPTIONAL | If `true`, the server will sponsor transaction fees. |
| `methodDetails.feePayerKey` | string | OPTIONAL | Stellar public key (`G...`) of the server's fee payer account. Present only when `feePayer` is `true`. |

The server SHOULD generate a unique `reference` for each
challenge to enable idempotent verification and audit
trailing. UUID v4 is RECOMMENDED.

When `network` is absent, clients SHOULD default to
`"testnet"`.

**Example:**

~~~ json
{
  "amount": "100000",
  "currency": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WW...",
  "recipient": "GC6ZBCI6M6PMBMRCZQMOGCUOZKFREM7P6G2NC...",
  "methodDetails": {
    "network": "testnet",
    "reference": "5904a0a7-9ade-4d6c-9b6b-58edc6e15964"
  }
}
~~~

This requests a transfer of 0.01 USDC (100000 stroops).

# Credential Schema {#credential-schema}

The credential in the `Authorization` header contains a
base64url-encoded JSON object per {{I-D.httpauth-payment}}.

## Credential Structure

After constructing and signing the payment transaction, the
client MUST retry the original request with an `Authorization`
header using the "Payment" scheme:

~~~http
Authorization: Payment <base64url-encoded-credential>
~~~

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `challenge` | object | REQUIRED | Echo of the challenge from the server |
| `payload` | object | REQUIRED | Stellar-specific payload object |
| `source` | string | OPTIONAL | Payer identifier (e.g., `did:pkh:stellar:<public-key>`) |

## Credential Payload Types

The credential payload is a discriminated union on the `type`
field. Two types are defined:

| Type | Mode | Description |
|------|------|-------------|
| `"transaction"` | Pull | Contains signed transaction XDR for server to broadcast. |
| `"signature"` | Push | Contains transaction hash of a client-broadcast transaction. |

## Transaction Payload (type="transaction") {#tx-payload}

In pull mode, the client signs but does NOT broadcast the
transaction. The credential payload MUST have the form:

~~~ json
{
  "type": "transaction",
  "xdr": "<base64-encoded-signed-transaction-envelope>"
}
~~~

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `xdr` | string | REQUIRED | Base64-encoded signed Stellar transaction envelope |
| `type` | string | REQUIRED | `"transaction"` |

The `xdr` field contains the complete signed Stellar
transaction envelope in base64 XDR encoding, as produced
by `TransactionBuilder.toXDR()`.

The transaction MUST:

- Contain exactly one `invokeHostFunction` operation
- Invoke the SAC `transfer(from, to, amount)` function
- Target the contract address specified in the challenge
  `currency` field
- Transfer to the address specified in the challenge
  `recipient` field
- Transfer the exact amount specified in the challenge
  `amount` field
- Be signed by the source account (the payer)
- Include Soroban resource data (from simulation)

The transaction MAY include a text memo if specified in
the challenge `methodDetails`.

## Hash Payload (type="signature") {#hash-payload}

In push mode, the client broadcasts the transaction and
waits for confirmation before sending the credential.
The credential payload MUST have the form:

~~~ json
{
  "type": "signature",
  "hash": "<64-character-hex-transaction-hash>"
}
~~~

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `hash` | string | REQUIRED | Transaction hash (64-character hex string) |
| `type` | string | REQUIRED | `"signature"` |

The transaction hash MUST correspond to a successful
transaction on the Stellar network specified in the
challenge. The client SHOULD poll `getTransaction` until
status is `"SUCCESS"` before sending the credential.

**Limitations:**

- Cannot be used with `feePayer: true` (client must pay
  their own fees)
- Server cannot modify or enhance the transaction

# Settlement Procedure

For `intent="charge"` fulfilled via transaction, the client
signs a transaction containing a `transfer` call. If
`feePayer` is configured, the server wraps it in a
`FeeBumpTransaction` before broadcasting:

~~~
  Client                       Server               Stellar Network
    |                            |                        |
    |  (1) Authorization:        |                        |
    |      Payment <credential>  |                        |
    |--------------------------->|                        |
    |                            |                        |
    |                            |  (2) If feePayer:      |
    |                            |      wrap in           |
    |                            |      FeeBumpTx         |
    |                            |                        |
    |                            |  (3) sendTransaction   |
    |                            |----------------------->|
    |                            |                        |
    |                            |  (4) Transfer executed |
    |                            |      (~5s finality)    |
    |                            |<-----------------------|
    |                            |                        |
    |  (5) 200 OK                |                        |
    |      Payment-Receipt:      |                        |
    |      <base64url-receipt>   |                        |
    |<---------------------------|                        |
    |                            |                        |
~~~

1. Client submits credential containing signed `transfer`
   transaction XDR
2. If `feePayer` is configured, server wraps in
   `FeeBumpTransaction` (see {{fee-sponsorship}})
3. Server broadcasts transaction to Stellar via Soroban RPC
4. Transaction included in ledger (~5 second finality)
5. Server returns a receipt whose `reference` field is the
   transaction hash

## Pull Mode Verification {#pull-verify}

Upon receiving a `"transaction"` credential, the server
MUST perform the following verification steps:

1. Deserialize the XDR using `TransactionBuilder.fromXDR()`
   with the expected network passphrase.
2. If the transaction is a `FeeBumpTransaction`, extract the
   inner transaction for verification.
3. Verify the SAC transfer invocation per
   {{sac-transfer-verification}}.
4. If fee sponsorship is configured and the transaction
   is not already fee-bumped, wrap it in a
   `FeeBumpTransaction` (see {{fee-sponsorship}}).
5. Broadcast the transaction via Soroban RPC
   `sendTransaction`.
6. Poll `getTransaction` until the status is no longer
   `"NOT_FOUND"`.
7. If status is `"SUCCESS"`, return a Receipt. Otherwise,
   return an error.

## Hash Settlement {#hash-settlement}

For credentials with `type="signature"`, the client has
already broadcast the transaction. The server verifies
the transaction on-chain:

~~~
  Client                       Server               Stellar Network
    |                            |                        |
    |  (1) Broadcast tx          |                        |
    |----------------------------------------------->     |
    |                            |                        |
    |  (2) Transaction confirmed |                        |
    |<-----------------------------------------------     |
    |                            |                        |
    |  (3) Authorization:        |                        |
    |      Payment <credential>  |                        |
    |      (with txHash)         |                        |
    |--------------------------->|                        |
    |                            |                        |
    |                            |  (4) getTransaction    |
    |                            |----------------------->|
    |                            |                        |
    |                            |  (5) Result returned   |
    |                            |<-----------------------|
    |                            |                        |
    |                            |  (6) Verify result     |
    |                            |                        |
    |  (7) 200 OK                |                        |
    |      Payment-Receipt:      |                        |
    |      <base64url-receipt>   |                        |
    |<---------------------------|                        |
    |                            |                        |
~~~

Upon receiving a `"signature"` credential, the server MUST:

1. Look up the transaction using the provided hash via
   Soroban RPC `getTransaction`.
2. If status is `"NOT_FOUND"`, poll up to 10 times with
   1-second intervals.
3. If status is `"SUCCESS"`, extract the transaction
   envelope and verify the SAC transfer per
   {{sac-transfer-verification}}.
4. If verification passes, return a Receipt.
5. If status is not `"SUCCESS"` after polling, return
   an error.

## SAC Transfer Verification {#sac-transfer-verification}

To verify a SAC transfer invocation, the server MUST
inspect the transaction's operations and confirm:

1. The transaction contains at least one
   `invokeHostFunction` operation.
2. The host function type is
   `hostFunctionTypeInvokeContract`.
3. The invoked contract address matches the expected
   `currency` (SAC contract address).
4. The invoked function name is `"transfer"`.
5. The function has at least 3 arguments:
   - `args[0]`: from (Address) — the payer
   - `args[1]`: to (Address) — MUST match the expected
     `recipient`
   - `args[2]`: amount (Int128/Int64/UInt64) — MUST match
     the expected `amount` in base units

The amount argument MAY be encoded as any of the following
Soroban ScVal integer types: `scvI128`, `scvU128`, `scvI64`,
`scvU64`, `scvI32`, `scvU32`. Implementations MUST support
all six types.

For hash credentials, servers MUST fetch the transaction
result and verify the envelope's invocation matches the
challenge parameters.

## Receipt Generation

Upon successful settlement, servers MUST return a
`Payment-Receipt` header per {{I-D.httpauth-payment}}.
Servers MUST NOT include a `Payment-Receipt` header on
error responses; failures are communicated via HTTP status
codes and Problem Details {{RFC9457}}.

The receipt payload for Stellar charge:

| Field | Type | Description |
|-------|------|-------------|
| `method` | string | `"stellar"` |
| `reference` | string | Stellar transaction hash |
| `status` | string | `"success"` |
| `timestamp` | string | {{RFC3339}} settlement time |
| `externalId` | string | OPTIONAL. Echoed from the challenge request |

# Transaction Construction

This section describes how clients MUST construct the SAC
transfer transaction.

## SAC Transfer Invocation

The client constructs a Soroban contract invocation:

    Contract: <challenge.currency>  (SAC contract address)
    Function: "transfer"
    Arguments:
      [0] from:   Address(client_public_key)  → ScVal(Address)
      [1] to:     Address(challenge.recipient) → ScVal(Address)
      [2] amount: BigInt(challenge.amount)     → ScVal(I128)

The amount SHOULD be encoded as I128 using `nativeToScVal`
with type `"i128"` for maximum compatibility.

## Transaction Simulation

Before signing, the client MUST simulate the transaction
using the Soroban RPC `prepareTransaction` method. This:

- Attaches the required Soroban resource footprint
- Calculates the resource fee
- Validates the transaction will succeed

If simulation fails, the client MUST NOT sign or submit
the transaction.

## Signing

The client signs the prepared transaction using its
Ed25519 keypair corresponding to the source account.
The signing process uses the network passphrase to
prevent cross-network replay.

# Fee Sponsorship {#fee-sponsorship}

When a request includes `feePayer: true`, the server
commits to paying transaction fees on behalf of the client.

## Server Configuration

Servers MAY configure a fee payer account to sponsor
transaction fees for clients. This is useful for
onboarding users who may not hold XLM for fees.

The fee payer is specified as a Stellar Keypair or
secret key string in the server's charge configuration.

## Challenge Advertisement

When fee sponsorship is enabled, the server MUST include
the following fields in the challenge's `methodDetails`:

~~~ json
{
  "feePayer": true,
  "feePayerKey": "<fee-payer-public-key>"
}
~~~

This informs the client that the server will pay the
network fees. The client MAY use this information for
display purposes but MUST NOT alter its transaction
construction process.

## FeeBumpTransaction Wrapping

In pull mode, after verifying the client's signed
transaction ({{pull-verify}}, step 3), the server:

1. MUST check if the transaction is already a
   `FeeBumpTransaction`. If so, skip wrapping.
2. Constructs a `FeeBumpTransaction` using:
   - Fee payer: the server's fee payer keypair
   - Fee: the inner transaction fee multiplied by 10
     (providing a generous buffer)
   - Inner transaction: the client's signed transaction
   - Network passphrase: the configured network
3. Signs the `FeeBumpTransaction` with the fee payer
   keypair.
4. Broadcasts the `FeeBumpTransaction` instead of the
   inner transaction.

Fee sponsorship is NOT applicable in push mode, as the
client broadcasts the transaction directly.

## Server Requirements

When acting as fee payer, servers:

- MUST maintain sufficient XLM balance to pay transaction
  fees
- MAY recover fee costs through pricing or other business
  logic
- SHOULD implement rate limiting to mitigate denial of
  service via fee exhaustion

## Client Requirements

- When `feePayer: true`: Clients construct and sign the
  transaction normally. The server wraps it in a
  `FeeBumpTransaction` before broadcasting.
- When `feePayer: false` or omitted: Clients MUST have
  sufficient XLM to pay fees themselves.

# Replay Protection

Servers SHOULD implement replay protection to prevent
challenge reuse. The RECOMMENDED approach:

1. Before processing a credential, generate a unique
   store key: `"stellar:challenge:<challenge-id>"`
2. Check the store for an existing entry. If found,
   reject the credential with "Challenge already used.
   Replay rejected."
3. After successful verification, store the challenge
   ID with the usage timestamp.

The store implementation is not specified by this
document. Implementations MAY use in-memory stores,
Redis, Cloudflare KV, Upstash, or any key-value store.

# Networks and Constants

## Network Identifiers

| ID | Network Passphrase |
|----|-------------------|
| `public` | `"Public Global Stellar Network ; September 2015"` |
| `testnet` | `"Test SDF Network ; September 2015"` |

## Well-Known SAC Addresses

The following SAC contract addresses are registered for
common assets:

| Asset | Network | SAC Contract Address |
|-------|---------|---------------------|
| USDC | `public` | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI` |
| USDC | `testnet` | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| XLM | `public` | `CAS3J7GYLGVE45MR3HPSFG352DAANEV5GGMFTO3IZIE4JMCDALQO57Y` |
| XLM | `testnet` | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

Implementations SHOULD use these addresses when
referencing common assets. Other SAC addresses MAY be
used for additional assets.

## RPC Endpoints

| Network | Soroban RPC URL |
|---------|----------------|
| `public` | `https://soroban-rpc.mainnet.stellar.gateway.fm` |
| `testnet` | `https://soroban-testnet.stellar.org` |

| Network | Horizon URL |
|---------|------------|
| `public` | `https://horizon.stellar.org` |
| `testnet` | `https://horizon-testnet.stellar.org` |

Implementations MAY use alternative RPC endpoints.

## Default Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `decimals` | `7` | Decimal places for amount conversion |
| `fee` | `"100"` | Base fee in stroops |
| `timeout` | `180` | Transaction timeout in seconds |
| `network` | `"testnet"` | Default network identifier |
| `mode` | `"pull"` | Default credential mode |
| `getTransaction.maxAttempts` | `10` | Max polling attempts for push mode verification |
| `getTransaction.intervalMs` | `1000` | Polling interval in milliseconds |

# Error Handling

The Stellar method uses the standard MPP error response
format (Problem Details {{RFC9457}}) with the following
specific error conditions:

| Condition | Status | Problem Type URI |
|-----------|--------|-----------------|
| No payment provided | 402 | `.../payment-required` |
| Challenge expired | 402 | `.../payment-expired` |
| Invalid credential format | 402 | `.../verification-failed` |
| SAC transfer mismatch | 402 | `.../verification-failed` |
| Transaction failed on-chain | 402 | `.../verification-failed` |
| Challenge replay detected | 402 | `.../verification-failed` |
| Unsupported credential type | 402 | `.../verification-failed` |

Error detail messages SHOULD include specific information
about the failure to aid debugging:

- "Transaction does not contain a Soroban invocation."
- "Transaction does not contain a matching SAC transfer
  invocation."
- "Transaction \<hash\> is not successful (status: FAILED)."
- "Challenge already used. Replay rejected."
- "Unsupported credential type \"\<type\>\"."

# Security Considerations

## Secret Key Handling

Client secret keys (`S...`) MUST be handled securely:

- MUST NOT be transmitted over the network.
- MUST NOT be logged or included in error messages.
- SHOULD be stored in environment variables or secure
  key management systems, not in source code.
- MUST be used only for transaction signing on the
  client side.

Server fee payer keys (when configured) are subject to
the same requirements.

## Transaction Verification

Servers MUST verify ALL of the following before accepting
a payment credential:

- Contract address matches the expected currency
- Recipient address matches the expected recipient
- Amount matches the expected amount exactly
- Function name is `"transfer"`
- Transaction is on the correct network (via passphrase)

Servers MUST NOT accept transactions that only partially
match (e.g., correct amount but wrong recipient).

## Replay Attacks

Without replay protection ({{replay-protection}}), a
client could reuse a valid credential to access the
resource multiple times with a single payment. Servers
SHOULD implement challenge-based replay protection.

The Stellar network itself prevents transaction replay
via sequence numbers, but MPP challenges can be replayed
at the application layer.

## Amount Verification

Servers MUST convert human-readable amounts to base units
(stroops) using integer arithmetic to avoid floating-point
precision errors.

The conversion MUST be:

    stroops = integer(amount * 10^decimals)

Servers MUST verify the exact stroop amount, not an
approximate floating-point comparison.

Clients MUST parse and verify the `request` payload
before signing:

1. Verify `amount` is reasonable for the service
2. Verify `currency` is the expected SAC contract address
3. Verify `recipient` is controlled by the expected party

## Network Passphrase Binding

The Stellar network passphrase is included in the
transaction hash, preventing cross-network replay.
Servers MUST verify transactions against the expected
network passphrase. A transaction signed for testnet
MUST NOT be accepted by a server expecting mainnet
payments, and vice versa.

## Server-Paid Fees

Servers acting as fee payers accept financial risk in
exchange for providing a seamless payment experience.

**Denial of Service**: Malicious clients could submit
valid-looking credentials that fail on-chain, causing the
server to pay fees without receiving payment. Servers
SHOULD implement rate limiting and MAY require client
authentication before accepting payment credentials.

**Fee Exhaustion**: Servers MUST monitor their XLM balance
and reject new payment requests when balance is
insufficient.

# IANA Considerations

## Payment Method Registration

This document registers the following payment method in
the "HTTP Payment Methods" registry established by
{{I-D.httpauth-payment}}:

| Method Identifier | Description | Reference |
|-------------------|-------------|-----------|
| `stellar` | Stellar blockchain SAC token transfer | This document |

Contact: Stellar Development Foundation
(<sagar.patil@stellar.org>)

## Payment Intent Registration

This document registers the following payment intent in
the "HTTP Payment Intents" registry established by
{{I-D.httpauth-payment}}:

| Intent | Applicable Methods | Description | Reference |
|--------|-------------------|-------------|-----------|
| `charge` | `stellar` | One-time SAC transfer | This document |

--- back

# ABNF Collected

~~~ abnf
stellar-charge-challenge = "Payment" 1*SP
  "id=" quoted-string ","
  "realm=" quoted-string ","
  "method=" DQUOTE "stellar" DQUOTE ","
  "intent=" DQUOTE "charge" DQUOTE ","
  "request=" base64url-nopad

stellar-charge-credential = "Payment" 1*SP
  base64url-nopad

; Base64url encoding without padding per RFC 4648 Section 5
base64url-nopad = 1*( ALPHA / DIGIT / "-" / "_" )
~~~

# Example Exchange {#example-exchange}

**Challenge:**

~~~ http
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
~~~

The `request` decodes to:

~~~ json
{
  "amount": "100000",
  "currency": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WW...",
  "recipient": "GC6ZBCI6M6PMBMRCZQMOGCUOZKFREM7P6G2NC...",
  "methodDetails": {
    "network": "testnet",
    "reference": "5904a0a7-9ade-4d6c-9b6b-58edc6e15964"
  }
}
~~~

This requests a transfer of 0.01 USDC (100000 stroops).

**Credential:**

~~~ http
GET /resource HTTP/1.1
Host: api.example.com
Authorization: Payment eyJjaGFsbGVuZ2UiOnsi...
~~~

**Success Response:**

~~~ http
HTTP/1.1 200 OK
Content-Type: application/json
Payment-Receipt: eyJtZXRob2QiOiJzdGVsbGFyIi...
~~~

~~~ json
{
  "message": "Payment verified — premium content.",
  "timestamp": "2026-03-19T00:00:05Z"
}
~~~

# JSON Schema Definitions

## Payment Request Schema

~~~ json
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
        "reference": {
          "type": "string",
          "format": "uuid"
        },
        "network": {
          "enum": ["public", "testnet"]
        },
        "memo": {
          "type": "string",
          "maxLength": 28
        },
        "feePayer": {
          "type": "boolean"
        },
        "feePayerKey": {
          "type": "string",
          "pattern": "^G[A-Z2-7]{55}$"
        }
      }
    }
  }
}
~~~

## Credential Payload Schema

~~~ json
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
          "description": "Base64-encoded signed tx XDR"
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
~~~

## Receipt Schema

~~~ json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": [
    "method", "reference", "status", "timestamp"
  ],
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
    },
    "externalId": {
      "type": "string",
      "description": "Echoed from challenge request"
    }
  }
}
~~~

# Acknowledgements

The authors thank the Stellar community and the MPP
working group for their feedback on this specification.
