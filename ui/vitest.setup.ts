/// <reference types="vitest" />

import '@testing-library/jest-dom/vitest'
import * as msgpack from 'algo-msgpack-with-bigint'
import { ABIMethod, ABIType, getMethodByName } from 'algosdk'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { APP_SPEC as ValidatorRegistrySpec } from '@/contracts/ValidatorRegistryClient'
import { SimulateRequest, SimulateResponse } from '@/interfaces/simulate'
import { concatUint8Arrays } from '@/utils/bytes'
import { MethodCallParams } from '@/utils/tests/abi'
import { LAST_ROUND, RETURN_PREFIX } from '@/utils/tests/constants'
import { boxFixtures } from '@/utils/tests/fixtures/boxes'
import { methodFixtures } from '@/utils/tests/fixtures/methods'
import { parseBoxName } from '@/utils/tests/utils'

if (!Object.prototype.isPrototypeOf.call(Buffer, Uint8Array)) {
  Object.setPrototypeOf(Buffer.prototype, Uint8Array.prototype)
}

const handlers = [
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
  http.post<never, Uint8Array>(
    'http://localhost:4001/v2/transactions/simulate',
    async ({ request }) => {
      try {
        /* Parse request URL */
        const url = new URL(request.url)
        const format = url.searchParams.get('format')

        // @todo: handle other formats?
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

const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())
