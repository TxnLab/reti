import * as msgpack from 'algo-msgpack-with-bigint'
import { ABIMethod, ABIType, getMethodByName } from 'algosdk'
import { HttpResponse, http } from 'msw'
import { APP_SPEC as ValidatorRegistrySpec } from '@/contracts/ValidatorRegistryClient'
import { Application, BlockHeader } from '@/interfaces/algod'
import { SimulateRequest, SimulateResponse } from '@/interfaces/simulate'
import { concatUint8Arrays } from '@/utils/bytes'
import { MethodCallParams } from '@/utils/tests/abi'
import {
  AVG_BLOCK_TIME_MS,
  CURRENT_TIME_MS,
  LAST_ROUND,
  RETURN_PREFIX,
} from '@/utils/tests/constants'
import { appFixtures } from '@/utils/tests/fixtures/applications'
import { boxFixtures } from '@/utils/tests/fixtures/boxes'
import { methodFixtures } from '@/utils/tests/fixtures/methods'
import { parseBoxName } from '@/utils/tests/utils'

const handlers = [
  http.get('http://localhost:4001/v2/blocks/:block', async ({ params, request }) => {
    try {
      /* Parse request URL */
      const url = new URL(request.url)
      const format = url.searchParams.get('format')

      if (format !== 'msgpack') {
        throw new Error('Unknown format')
      }

      // console.log(`Captured a "GET ${url.pathname}?format=${format}" request`)

      const blockNum = Number(params.block)

      // Ensure block number is within a valid range
      if (blockNum > LAST_ROUND) {
        throw new Error(`Invalid block number: ${blockNum}`)
      }

      const offset = (LAST_ROUND - blockNum) * AVG_BLOCK_TIME_MS

      const mockBlockHeader: Partial<BlockHeader> = {
        ts: Math.round((CURRENT_TIME_MS - offset) / 1000),
      }

      const responseBuffer = msgpack.encode({
        block: mockBlockHeader,
      })

      return HttpResponse.arrayBuffer(responseBuffer, {
        headers: {
          'Content-Type': 'application/msgpack',
        },
      })
    } catch (error) {
      console.error('Error fetching data:', error)
      return HttpResponse.error()
    }
  }),
  http.get('http://localhost:4001/v2/status', async () => {
    // console.log('Captured a "GET /v2/status" request')

    return HttpResponse.json({
      'last-round': LAST_ROUND,
    })
  }),
  http.get('http://localhost:4001/v2/transactions/params', async () => {
    // console.log('Captured a "GET /v2/transactions/params" request')

    const response = {
      'consensus-version': 'future',
      fee: 0,
      'genesis-hash': 'v1lkQZYrxQn1XDRkIAlsUrSSECXU6OFMbPMhj/QQ9dk=',
      'genesis-id': 'dockernet-v1',
      'last-round': LAST_ROUND,
      'min-fee': 1000,
    }

    return HttpResponse.json(response)
  }),
  http.get('http://localhost:4001/v2/applications/:appId', async ({ params }) => {
    try {
      /* Parse request URL */
      // const url = new URL(request.url)
      // console.log(`Captured a "GET ${url.pathname}" request`)

      const appId = Number(params.appId)
      const response: Application = appFixtures[appId]

      return HttpResponse.json(response)
    } catch (error) {
      console.error('Error fetching data:', error)
      return HttpResponse.error()
    }
  }),
  http.post<never, Uint8Array>(
    'http://localhost:4001/v2/transactions/simulate',
    async ({ request }) => {
      try {
        /* Parse request URL */
        const url = new URL(request.url)
        const format = url.searchParams.get('format')

        if (format !== 'msgpack') {
          throw new Error('Unknown format')
        }

        // console.log(`Captured a "POST ${url.pathname}?format=${format}" request`)

        /* Inspect request */
        const requestBody = await request.arrayBuffer()
        const decodedRequest = msgpack.decode(new Uint8Array(requestBody)) as SimulateRequest
        // console.log('decodedRequest', decodedRequest)

        const txns = decodedRequest['txn-groups'][0].txns
        const txn = txns[0]

        if (!txn.txn.note) {
          throw new Error('Missing note')
        }
        const decoder = new TextDecoder()
        const note = decoder.decode(txn.txn.note) as string
        const callParams = JSON.parse(note) as MethodCallParams

        /* Construct mock response */
        const methods = ValidatorRegistrySpec.contract.methods.map(
          (method) => new ABIMethod(method),
        )
        const method = getMethodByName(methods, callParams.method)
        if (!method) {
          throw new Error('Method not found')
        }

        const getFixtureData = methodFixtures[callParams.method]
        if (!getFixtureData) {
          throw new Error(`No fixture data available for method: ${callParams.method}`)
        }

        const fixtureData = getFixtureData(callParams.args)

        const returnType = ABIType.from(method.returns.type.toString())
        const returnValue = returnType.encode(fixtureData)
        const returnLogs = [concatUint8Arrays(RETURN_PREFIX, returnValue)]

        const mockResponse: SimulateResponse = {
          'last-round': LAST_ROUND,
          version: 2,
          'txn-groups': [
            {
              'txn-results': [
                {
                  'txn-result': {
                    logs: returnLogs,
                    'pool-error': '',
                    txn,
                  },
                },
              ],
            },
          ],
        }

        /* Inspect actual response */
        // const response = await fetch(bypass(request)).then((response) => response.arrayBuffer())
        // const decodedResponse = msgpack.decode(new Uint8Array(response)) as SimulateResponse
        // // console.log('decodedResponse', decodedResponse)

        /* Encode response */
        const responseBuffer = msgpack.encode(mockResponse)

        return HttpResponse.arrayBuffer(responseBuffer, {
          headers: {
            'Content-Type': 'application/msgpack',
          },
        })
      } catch (error) {
        console.error('Error fetching data:', error)
        return HttpResponse.error()
      }
    },
  ),
  http.get('http://localhost:4001/v2/applications/:id/box', async ({ params, request }) => {
    // console.log(`Captured a "GET /v2/applications/${params.id}/box" request`)

    try {
      /* Parse request URL */
      const url = new URL(request.url)
      const name = url.searchParams.get('name')
      if (!name) {
        throw new Error('Missing name parameter')
      }

      const [, boxName] = parseBoxName(name)
      const appId = Number(params.id)

      const boxesForApp = boxFixtures[appId]
      if (!boxesForApp) {
        throw new Error(`No fixtures found for app ID: ${appId}`)
      }

      const boxData = boxesForApp[boxName]
      if (!boxData) {
        throw new Error(`Box name "${boxName}" not recognized`)
      }

      const textEncoder = new TextEncoder()
      const response = textEncoder.encode(JSON.stringify(boxData)).buffer

      /* Inspect actual response */
      // const response = await fetch(bypass(request)).then((response) => response.arrayBuffer())

      // const textDecoder = new TextDecoder()
      // const jsonString = textDecoder.decode(response)
      // const jsonData = JSON.parse(jsonString)

      // jsonData.name = Buffer.from(jsonData.name, 'base64').toString()
      // jsonData.value = new Uint8Array(Buffer.from(jsonData.value))

      return HttpResponse.arrayBuffer(response, {
        headers: {
          'Content-Type': 'application/msgpack',
        },
      })
    } catch (error) {
      console.error('Error fetching data:', error)
      return HttpResponse.error()
    }
  }),
]

export { handlers }
