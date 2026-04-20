import {
  Address,
  BASE_FEE,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk'
import { Server as SorobanServer, Api } from '@stellar/stellar-sdk/rpc'
import { Credential, Method, Receipt, Store } from 'mppx'
import { Mppx as MppxServer } from 'mppx/server'
import { Mppx as MppxClient } from 'mppx/client'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMEOUT,
  NETWORK_PASSPHRASE,
  STELLAR_TESTNET,
  XLM_SAC_TESTNET,
  SOROBAN_RPC_URLS,
} from '../../constants.js'
import { wrapFeeBump } from '../../shared/fee-bump.js'
import { pollTransaction } from '../../shared/poll.js'
import { resolveNetworkId } from '../../shared/validation.js'
import { charge as chargeMethod } from '../Methods.js'
import { charge as serverCharge } from '../server/Charge.js'
import { charge as clientCharge } from '../client/Charge.js'

const TEST_PAYER = Keypair.random()
const TEST_RECIPIENT = Keypair.random().publicKey()
const TEST_ENVELOPE_SIGNER = Keypair.random()
const TEST_FEE_PAYER = Keypair.random()

const MPP_SECRET_KEY = 'e2e-test-secret-key'
const sorobanServer = new SorobanServer(SOROBAN_RPC_URLS[STELLAR_TESTNET])

/**
 * Builds a charge client that wraps the signed inner tx in a
 * `FeeBumpTransaction` before returning it to the server (pull) or
 * broadcasting it itself (push). Mirrors `examples/charge-client-fee-bump.ts`.
 *
 * Used to exercise the unsponsored-with-feeBump flows the built-in
 * `clientCharge()` factory does not cover.
 */
function feeBumpChargeClient(payerKP: Keypair, feeBumpKP: Keypair, mode: 'push' | 'pull') {
  return Method.toClient(chargeMethod, {
    async createCredential({ challenge }) {
      const { request } = challenge
      const { amount, currency, recipient } = request
      const network = resolveNetworkId(request.methodDetails?.network)
      const networkPassphrase = NETWORK_PASSPHRASE[network]
      const server = new rpc.Server(SOROBAN_RPC_URLS[network])

      const contract = new Contract(currency)
      const sourceAccount = await server.getAccount(payerKP.publicKey())

      const tx = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          contract.call(
            'transfer',
            new Address(payerKP.publicKey()).toScVal(),
            new Address(recipient).toScVal(),
            nativeToScVal(BigInt(amount), { type: 'i128' }),
          ),
        )
        .setTimeout(DEFAULT_TIMEOUT)
        .build()

      const prepared = await server.prepareTransaction(tx)
      prepared.sign(payerKP)

      const feeBumpTx = wrapFeeBump(prepared, feeBumpKP, { networkPassphrase })
      const source = `did:pkh:${network}:${payerKP.publicKey()}`

      if (mode === 'push') {
        const result = await server.sendTransaction(feeBumpTx)
        if (result.status !== 'PENDING') {
          throw new Error(`Broadcast failed: sendTransaction returned ${result.status}`)
        }
        await pollTransaction(server, result.hash, {})
        return Credential.serialize({
          challenge,
          payload: { type: 'hash' as const, hash: result.hash },
          source,
        })
      }

      return Credential.serialize({
        challenge,
        payload: { type: 'transaction' as const, transaction: feeBumpTx.toXDR() },
        source,
      })
    },
  })
}

/**
 * Wraps an mppx server handler as a standard fetch function so the mppx client
 * can drive the full 402 -> credential -> verify flow without a real HTTP
 * server.
 */
function handlerAsFetch(
  handler: (
    request: Request,
  ) => Promise<{ status: number; challenge?: Response; withReceipt?: (r: Response) => Response }>,
): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const result = await handler(request)
    if (result.status === 402) {
      return result.challenge!
    }
    return result.withReceipt!(Response.json({ message: 'paid' }))
  }
}

describe('charge e2e (testnet)', () => {
  beforeAll(async () => {
    await Promise.all([
      sorobanServer.fundAddress(TEST_PAYER.publicKey()),
      sorobanServer.fundAddress(TEST_RECIPIENT),
      sorobanServer.fundAddress(TEST_ENVELOPE_SIGNER.publicKey()),
      sorobanServer.fundAddress(TEST_FEE_PAYER.publicKey()),
    ])
  }, 30_000)

  it('completes a pull-mode charge', async () => {
    const serverMppx = MppxServer.create({
      secretKey: MPP_SECRET_KEY,
      methods: [
        serverCharge({
          recipient: TEST_RECIPIENT,
          currency: XLM_SAC_TESTNET,
          store: Store.memory(),
        }),
      ],
    })

    const handler = serverMppx.charge({ amount: '1' })

    // Wire the server handler into the client as a custom fetch
    const clientMppx = MppxClient.create({
      polyfill: false,
      fetch: handlerAsFetch(handler),
      methods: [
        clientCharge({
          keypair: TEST_PAYER,
        }),
      ],
    })

    const response = await clientMppx.fetch('http://localhost/test')

    // The response should be a successful 200 with a receipt
    expect(response.status).toBe(200)

    const receiptHeader = response.headers.get('Payment-Receipt')
    expect(receiptHeader).toBeTruthy()

    // Deserialize and validate the receipt
    const receipt = Receipt.deserialize(receiptHeader!)
    expect(receipt.status).toBe('success')
    expect(receipt.method).toBe('stellar')
    expect(receipt.reference).toBeTruthy()
    // The reference should be a 64-char hex tx hash
    expect(receipt.reference).toMatch(/^[a-f0-9]{64}$/)

    // The transaction should be successful
    const txHash = receipt.reference
    const tx = (await sorobanServer.getTransaction(txHash)) as Api.GetSuccessfulTransactionResponse
    expect(tx.txHash).toEqual(receipt.reference)
    expect(tx.status).toBe(Api.GetTransactionStatus.SUCCESS)
    expect(tx.feeBump).toBe(false)

    // The transaction should be sourced from the payer
    const envelope = TransactionBuilder.fromXDR(
      tx.envelopeXdr,
      NETWORK_PASSPHRASE[STELLAR_TESTNET],
    ) as Transaction
    expect(envelope.source).toBe(TEST_PAYER.publicKey())
    expect(envelope.signatures.length).toBe(1)
  }, 120_000)

  it('completes a push-mode charge', async () => {
    const serverMppx = MppxServer.create({
      secretKey: MPP_SECRET_KEY,
      methods: [
        serverCharge({
          recipient: TEST_RECIPIENT,
          currency: XLM_SAC_TESTNET,
          store: Store.memory(),
        }),
      ],
    })

    const handler = serverMppx.charge({ amount: '1' })

    // Wire the server handler into the client as a custom fetch
    const clientMppx = MppxClient.create({
      polyfill: false,
      fetch: handlerAsFetch(handler),
      methods: [
        clientCharge({
          keypair: TEST_PAYER,
          mode: 'push',
        }),
      ],
    })

    const response = await clientMppx.fetch('http://localhost/test')

    // The response should be a successful 200 with a receipt
    expect(response.status).toBe(200)

    const receiptHeader = response.headers.get('Payment-Receipt')
    expect(receiptHeader).toBeTruthy()

    // Deserialize and validate the receipt
    const receipt = Receipt.deserialize(receiptHeader!)
    expect(receipt.status).toBe('success')
    expect(receipt.method).toBe('stellar')
    expect(receipt.reference).toBeTruthy()
    // The reference should be a 64-char hex tx hash
    expect(receipt.reference).toMatch(/^[a-f0-9]{64}$/)

    // Same validation as in the previous test
    const txHash = receipt.reference
    const tx = (await sorobanServer.getTransaction(txHash)) as Api.GetSuccessfulTransactionResponse
    expect(tx.txHash).toEqual(receipt.reference)
    expect(tx.status).toBe(Api.GetTransactionStatus.SUCCESS)
    expect(tx.feeBump).toBe(false)
    const envelope = TransactionBuilder.fromXDR(
      tx.envelopeXdr,
      NETWORK_PASSPHRASE[STELLAR_TESTNET],
    ) as Transaction
    expect(envelope.source).toBe(TEST_PAYER.publicKey())
    expect(envelope.signatures.length).toBe(1)
  }, 120_000)

  it('completes a pull-mode charge, with envelopeSigner', async () => {
    const serverMppx = MppxServer.create({
      secretKey: MPP_SECRET_KEY,
      methods: [
        serverCharge({
          recipient: TEST_RECIPIENT,
          currency: XLM_SAC_TESTNET,
          store: Store.memory(),
          feePayer: {
            envelopeSigner: TEST_ENVELOPE_SIGNER,
          },
        }),
      ],
    })

    const handler = serverMppx.charge({ amount: '1' })

    // Wire the server handler into the client as a custom fetch
    const clientMppx = MppxClient.create({
      polyfill: false,
      fetch: handlerAsFetch(handler),
      methods: [
        clientCharge({
          keypair: TEST_PAYER,
        }),
      ],
    })

    const response = await clientMppx.fetch('http://localhost/test')

    // The response should be a successful 200 with a receipt
    expect(response.status).toBe(200)

    const receiptHeader = response.headers.get('Payment-Receipt')
    expect(receiptHeader).toBeTruthy()

    // Deserialize and validate the receipt
    const receipt = Receipt.deserialize(receiptHeader!)
    expect(receipt.status).toBe('success')
    expect(receipt.method).toBe('stellar')
    expect(receipt.reference).toBeTruthy()
    // The reference should be a 64-char hex tx hash
    expect(receipt.reference).toMatch(/^[a-f0-9]{64}$/)

    const txHash = receipt.reference
    const tx = (await sorobanServer.getTransaction(txHash)) as Api.GetSuccessfulTransactionResponse
    // The transaction should be successful
    expect(tx.txHash).toEqual(receipt.reference)
    expect(tx.status).toBe(Api.GetTransactionStatus.SUCCESS)
    expect(tx.feeBump).toBe(false)

    // The transaction source should NOT be the payer
    const envelope = TransactionBuilder.fromXDR(
      tx.envelopeXdr,
      NETWORK_PASSPHRASE[STELLAR_TESTNET],
    ) as Transaction
    expect(envelope.source).toBe(TEST_ENVELOPE_SIGNER.publicKey())
    expect(envelope.signatures.length).toBe(1)
    expect(envelope.signatures[0].hint()).toEqual(TEST_ENVELOPE_SIGNER.signatureHint())
  }, 120_000)

  it('completes a pull-mode charge, with feeBumpSigner', async () => {
    const serverMppx = MppxServer.create({
      secretKey: MPP_SECRET_KEY,
      methods: [
        serverCharge({
          recipient: TEST_RECIPIENT,
          currency: XLM_SAC_TESTNET,
          store: Store.memory(),
          feePayer: {
            envelopeSigner: TEST_ENVELOPE_SIGNER,
            feeBumpSigner: TEST_FEE_PAYER,
          },
        }),
      ],
    })

    const handler = serverMppx.charge({ amount: '1' })

    // Wire the server handler into the client as a custom fetch
    const clientMppx = MppxClient.create({
      polyfill: false,
      fetch: handlerAsFetch(handler),
      methods: [
        clientCharge({
          keypair: TEST_PAYER,
        }),
      ],
    })

    const response = await clientMppx.fetch('http://localhost/test')

    // The response should be a successful 200 with a receipt
    expect(response.status).toBe(200)

    const receiptHeader = response.headers.get('Payment-Receipt')
    expect(receiptHeader).toBeTruthy()

    // Deserialize and validate the receipt
    const receipt = Receipt.deserialize(receiptHeader!)
    expect(receipt.status).toBe('success')
    expect(receipt.method).toBe('stellar')
    expect(receipt.reference).toBeTruthy()
    // The reference should be a 64-char hex tx hash
    expect(receipt.reference).toMatch(/^[a-f0-9]{64}$/)

    const txHash = receipt.reference
    const tx = (await sorobanServer.getTransaction(txHash)) as Api.GetSuccessfulTransactionResponse
    // The transaction should be successful
    expect(tx.txHash).toEqual(receipt.reference)
    expect(tx.status).toBe(Api.GetTransactionStatus.SUCCESS)

    // The outer transaction should be a feeBumpTransaction
    expect(tx.feeBump).toBe(true)
    const outerEnv = TransactionBuilder.fromXDR(
      tx.envelopeXdr,
      NETWORK_PASSPHRASE[STELLAR_TESTNET],
    ) as FeeBumpTransaction
    expect(outerEnv.feeSource).toBe(TEST_FEE_PAYER.publicKey())
    expect(outerEnv.signatures.length).toBe(1)
    expect(outerEnv.signatures[0].hint()).toEqual(TEST_FEE_PAYER.signatureHint())
    expect(outerEnv.innerTransaction).toBeTruthy()

    // The inner transaction should look correct
    const innerEnv = outerEnv.innerTransaction
    expect(innerEnv.source).toBe(TEST_ENVELOPE_SIGNER.publicKey())
    expect(innerEnv.signatures.length).toBe(1)
    expect(innerEnv.signatures[0].hint()).toEqual(TEST_ENVELOPE_SIGNER.signatureHint())
  }, 120_000)

  it('completes a push-mode charge, client-wrapped in FeeBump (unsponsored)', async () => {
    const serverMppx = MppxServer.create({
      secretKey: MPP_SECRET_KEY,
      methods: [
        serverCharge({
          recipient: TEST_RECIPIENT,
          currency: XLM_SAC_TESTNET,
          store: Store.memory(),
        }),
      ],
    })

    const handler = serverMppx.charge({ amount: '1' })

    const clientMppx = MppxClient.create({
      polyfill: false,
      fetch: handlerAsFetch(handler),
      methods: [feeBumpChargeClient(TEST_PAYER, TEST_FEE_PAYER, 'push')],
    })

    const response = await clientMppx.fetch('http://localhost/test')

    expect(response.status).toBe(200)

    const receiptHeader = response.headers.get('Payment-Receipt')
    const receipt = Receipt.deserialize(receiptHeader!)
    expect(receipt.status).toBe('success')
    expect(receipt.method).toBe('stellar')
    expect(receipt.reference).toMatch(/^[a-f0-9]{64}$/)

    const txHash = receipt.reference
    const tx = (await sorobanServer.getTransaction(txHash)) as Api.GetSuccessfulTransactionResponse
    expect(tx.txHash).toEqual(receipt.reference)
    expect(tx.status).toBe(Api.GetTransactionStatus.SUCCESS)

    // Outer envelope is a FeeBumpTransaction paid by the fee-bump key,
    // inner envelope is the payer's signed transfer.
    expect(tx.feeBump).toBe(true)
    const outerEnv = TransactionBuilder.fromXDR(
      tx.envelopeXdr,
      NETWORK_PASSPHRASE[STELLAR_TESTNET],
    ) as FeeBumpTransaction
    expect(outerEnv.feeSource).toBe(TEST_FEE_PAYER.publicKey())
    expect(outerEnv.signatures.length).toBe(1)
    expect(outerEnv.signatures[0].hint()).toEqual(TEST_FEE_PAYER.signatureHint())

    const innerEnv = outerEnv.innerTransaction
    expect(innerEnv.source).toBe(TEST_PAYER.publicKey())
    expect(innerEnv.signatures.length).toBe(1)
    expect(innerEnv.signatures[0].hint()).toEqual(TEST_PAYER.signatureHint())
  }, 120_000)

  it('completes a pull-mode charge, client-wrapped in FeeBump (unsponsored)', async () => {
    const serverMppx = MppxServer.create({
      secretKey: MPP_SECRET_KEY,
      methods: [
        serverCharge({
          recipient: TEST_RECIPIENT,
          currency: XLM_SAC_TESTNET,
          store: Store.memory(),
        }),
      ],
    })

    const handler = serverMppx.charge({ amount: '1' })

    const clientMppx = MppxClient.create({
      polyfill: false,
      fetch: handlerAsFetch(handler),
      methods: [feeBumpChargeClient(TEST_PAYER, TEST_FEE_PAYER, 'pull')],
    })

    const response = await clientMppx.fetch('http://localhost/test')

    expect(response.status).toBe(200)

    const receiptHeader = response.headers.get('Payment-Receipt')
    const receipt = Receipt.deserialize(receiptHeader!)
    expect(receipt.status).toBe('success')
    expect(receipt.method).toBe('stellar')
    expect(receipt.reference).toMatch(/^[a-f0-9]{64}$/)

    const txHash = receipt.reference
    const tx = (await sorobanServer.getTransaction(txHash)) as Api.GetSuccessfulTransactionResponse
    expect(tx.txHash).toEqual(receipt.reference)
    expect(tx.status).toBe(Api.GetTransactionStatus.SUCCESS)

    // Outer envelope is a FeeBumpTransaction paid by the fee-bump key,
    // inner envelope is the payer's signed transfer.
    expect(tx.feeBump).toBe(true)
    const outerEnv = TransactionBuilder.fromXDR(
      tx.envelopeXdr,
      NETWORK_PASSPHRASE[STELLAR_TESTNET],
    ) as FeeBumpTransaction
    expect(outerEnv.feeSource).toBe(TEST_FEE_PAYER.publicKey())
    expect(outerEnv.signatures.length).toBe(1)
    expect(outerEnv.signatures[0].hint()).toEqual(TEST_FEE_PAYER.signatureHint())

    const innerEnv = outerEnv.innerTransaction
    expect(innerEnv.source).toBe(TEST_PAYER.publicKey())
    expect(innerEnv.signatures.length).toBe(1)
    expect(innerEnv.signatures[0].hint()).toEqual(TEST_PAYER.signatureHint())
  }, 120_000)
})
