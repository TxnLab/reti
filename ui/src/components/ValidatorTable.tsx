import * as algokit from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { useQuery } from '@tanstack/react-query'
import { ColumnDef } from '@tanstack/react-table'
import { useWallet } from '@txnlab/use-wallet'
import algosdk from 'algosdk'
import { MoreHorizontal } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { DataTableColumnHeader } from '@/components/DataTableColumnHeader'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ValidatorRegistryClient } from '@/contracts/ValidatorRegistryClient'
import { formatDuration } from '@/utils/dayjs'
import { ellipseAddress } from '@/utils/ellipseAddress'
import {
  getNfdRegistryAppIdFromViteEnvironment,
  getRetiAppIdFromViteEnvironment,
} from '@/utils/env'
import { getAlgodConfigFromViteEnvironment } from '@/utils/network/getAlgoClientConfigs'

const algodConfig = getAlgodConfigFromViteEnvironment()
const algodClient = algokit.getAlgoClient({
  server: algodConfig.server,
  port: algodConfig.port,
  token: algodConfig.token,
})

const RETI_APP_ID = getRetiAppIdFromViteEnvironment()
const NFD_REGISTRY_APP_ID = getNfdRegistryAppIdFromViteEnvironment()

type ValidatorConfigRaw = [
  bigint,
  string,
  string,
  bigint,
  number,
  number,
  string,
  bigint,
  bigint,
  number,
]

interface ValidatorConfig {
  ID: bigint // ID of this validator (sequentially assigned)
  Owner: string // Account that controls config - presumably cold-wallet
  Manager: string // Account that triggers/pays for payouts and keyreg transactions - needs to be hotwallet as node has to sign for the transactions
  NFDForInfo: bigint
  PayoutEveryXMins: number // Payout frequency in minutes (can be no shorter than this)
  PercentToValidator: number // Payout percentage expressed w/ four decimals - ie: 50000 = 5% -> .0005 -
  ValidatorCommissionAddress: string // account that receives the validation commission each epoch payout (can be ZeroAddress)
  MinEntryStake: bigint // minimum stake required to enter pool - but must withdraw all if they want to go below this amount as well(!)
  MaxAlgoPerPool: bigint // maximum stake allowed per pool (to keep under incentive limits)
  PoolsPerNode: number // Number of pools to allow per node (max of 3 is recommended)
}

type ValidatorStateRaw = [number, bigint, bigint]

interface ValidatorState {
  NumPools: number // current number of pools this validator has - capped at MaxPools
  TotalStakers: bigint // total number of stakers across all pools
  TotalAlgoStaked: bigint // total amount staked to this validator across ALL of its pools
}

type Validator = {
  id: number
  owner: string
  manager: string
  nfd: number
  payoutFrequency: number
  commission: number
  commissionAccount: string
  minStake: number
  maxStake: number
  maxPools: number
  numPools: number
  numStakers: number
  totalStaked: number
}

export function ValidatorTable() {
  const { activeAddress } = useWallet()

  const getValidators = async () => {
    try {
      const validatorClient = new ValidatorRegistryClient(
        {
          sender: { addr: activeAddress as string, signer: algosdk.makeEmptyTransactionSigner() },
          resolveBy: 'id',
          id: RETI_APP_ID,
          deployTimeParams: {
            NFDRegistryAppID: NFD_REGISTRY_APP_ID,
          },
        },
        algodClient,
      )

      // App call to fetch total number of validators
      const numValidatorsResponse = await validatorClient
        .compose()
        .getNumValidators({})
        .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })

      const numValidators = numValidatorsResponse.returns![0]

      if (!numValidators) {
        throw new Error('No validators found')
      }

      const allValidators: Array<Validator> = []
      const batchSize = 10

      for (let i = 0; i < numValidators; i += batchSize) {
        const batchPromises = Array.from(
          { length: Math.min(batchSize, Number(numValidators) - i) },
          (_, index) => {
            const validatorID = i + index + 1
            return fetchValidatorData(validatorID, validatorClient)
          },
        )

        // Run batch calls in parallel, then filter out any undefined results
        const batchResults = (await Promise.all(batchPromises)).filter(
          (validator) => validator !== undefined,
        ) as Array<Validator>

        allValidators.push(...batchResults)
      }

      return allValidators
    } catch (error) {
      console.error(error)
      throw error
    }
  }

  async function fetchValidatorData(validatorID: number, validatorClient: ValidatorRegistryClient) {
    try {
      // App call to fetch validator config
      const configPromise = validatorClient
        .compose()
        .getValidatorConfig({ validatorID })
        .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })

      // App call to fetch current validator state
      const statePromise = validatorClient
        .compose()
        .getValidatorState({ validatorID })
        .simulate({ allowEmptySignatures: true, allowUnnamedResources: true })

      // Run both calls in parallel
      const [configResult, stateResult] = await Promise.all([configPromise, statePromise])

      const rawConfig = configResult.returns![0] as ValidatorConfigRaw
      const rawState = stateResult.returns![0] as ValidatorStateRaw

      // Transform raw data to Validator object
      const validator: Validator = transformValidatorData(rawConfig, rawState)
      return validator
    } catch (error) {
      console.error(`Failed to fetch data for validator ID ${validatorID}:`, error)
      return undefined
    }
  }

  function transformValidatorData(
    rawConfig: ValidatorConfigRaw,
    rawState: ValidatorStateRaw,
  ): Validator {
    const config: ValidatorConfig = {
      ID: rawConfig[0],
      Owner: rawConfig[1],
      Manager: rawConfig[2],
      NFDForInfo: rawConfig[3],
      PayoutEveryXMins: rawConfig[4],
      PercentToValidator: rawConfig[5],
      ValidatorCommissionAddress: rawConfig[6],
      MinEntryStake: rawConfig[7],
      MaxAlgoPerPool: rawConfig[8],
      PoolsPerNode: rawConfig[9],
    }

    const state: ValidatorState = {
      NumPools: rawState[0],
      TotalStakers: rawState[1],
      TotalAlgoStaked: rawState[2],
    }

    return {
      id: Number(config.ID),
      owner: config.Owner,
      manager: config.Manager,
      nfd: Number(config.NFDForInfo),
      payoutFrequency: config.PayoutEveryXMins,
      commission: config.PercentToValidator,
      commissionAccount: config.ValidatorCommissionAddress,
      minStake: Number(config.MinEntryStake),
      maxStake: Number(config.MaxAlgoPerPool),
      maxPools: config.PoolsPerNode,
      numPools: state.NumPools,
      numStakers: Number(state.TotalStakers),
      totalStaked: Number(state.TotalAlgoStaked),
    }
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ['validators'],
    queryFn: getValidators,
    enabled: !!activeAddress,
    retry: false,
  })

  const columns: ColumnDef<Validator>[] = [
    // {
    //   accessorKey: 'id',
    //   header: ({ column }) => <DataTableColumnHeader column={column} title="ID" />,
    // },
    {
      id: 'validator',
      accessorFn: (row) => row.owner,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Validator" />,
      cell: ({ row }) => {
        const nfdAppId = row.original.nfd
        if (nfdAppId > 0) {
          return ellipseAddress(row.original.owner) // @todo: fetch NFD by appId
        }
        return ellipseAddress(row.original.owner)
      },
    },
    {
      id: 'minStake',
      accessorFn: (row) => row.minStake,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Min Stake" />,
      cell: ({ row }) => {
        const amount = parseFloat(row.getValue('minStake'))
        const algoAmount = AlgoAmount.MicroAlgos(amount).algos
        const formatted = new Intl.NumberFormat('en-US', { notation: 'compact' }).format(algoAmount)

        return formatted
      },
    },
    {
      id: 'maxStake',
      accessorFn: (row) => row.maxStake,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Max Stake" />,
      cell: ({ row }) => {
        const amount = parseFloat(row.getValue('maxStake'))
        const algoAmount = AlgoAmount.MicroAlgos(amount).algos
        const formatted = new Intl.NumberFormat('en-US', { notation: 'compact' }).format(algoAmount)

        return formatted
      },
    },
    {
      id: 'spacesLeft',
      accessorFn: (row) => 100 - row.numStakers,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Spaces Left" />,
      cell: ({ row }) => {
        const maxStakers = 100
        const spacesLeft = maxStakers - row.original.numStakers
        return spacesLeft
      },
    },
    {
      id: 'totalStaked',
      accessorFn: (row) => row.totalStaked,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Current Stake" />,
      cell: ({ row }) => {
        const amount = parseFloat(row.getValue('totalStaked'))
        const algoAmount = AlgoAmount.MicroAlgos(amount).algos
        const formatted = new Intl.NumberFormat('en-US', { notation: 'compact' }).format(algoAmount)

        return formatted
      },
    },
    {
      id: 'commission',
      accessorFn: (row) => row.commission,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Commission" />,
      cell: ({ row }) => {
        const percent = parseFloat(row.getValue('commission')) / 10000
        return `${percent}%`
      },
    },
    {
      id: 'payoutFrequency',
      accessorFn: (row) => row.payoutFrequency,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Payout Frequency" />,
      cell: ({ row }) => {
        const minutes = parseInt(row.getValue('payoutFrequency'))
        return formatDuration(minutes)
      },
    },
    {
      id: 'actions',
      cell: () => {
        return (
          <div className="flex items-center gap-x-2">
            <Button size="sm">Stake</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Stake</DropdownMenuItem>
                <DropdownMenuItem disabled>Restake</DropdownMenuItem>
                <DropdownMenuItem disabled>Unstake</DropdownMenuItem>
                <DropdownMenuItem disabled>Claim rewards</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
    },
  ]

  if (isLoading) {
    return <div>Loading...</div>
  }

  if (error) {
    return <div>Error: {error.message}</div>
  }

  if (!data) {
    return null
  }

  return (
    <DataTable
      columns={columns}
      data={data}
      columnPinningState={{ left: ['validator'], right: [] }}
      columnPinningThreshold="lg"
    />
  )
}
