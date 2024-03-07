import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Link } from '@tanstack/react-router'
import { ColumnDef } from '@tanstack/react-table'
import { MoreHorizontal } from 'lucide-react'
import { DataTable } from '@/components/DataTable'
import { DataTableColumnHeader } from '@/components/DataTableColumnHeader'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Validator } from '@/interfaces/validator'
import { formatDuration } from '@/utils/dayjs'
import { ellipseAddress } from '@/utils/ellipseAddress'

interface ValidatorTableProps {
  validators: Validator[]
}

export function ValidatorTable({ validators }: ValidatorTableProps) {
  const columns: ColumnDef<Validator>[] = [
    {
      accessorKey: 'id',
      header: ({ column }) => <DataTableColumnHeader column={column} title="ID" />,
      size: 70,
    },
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
        if (row.original.numPools == 0) return '--'
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
      cell: ({ row }) => {
        const stakingDisabled =
          row.original.numStakers >= 100 ||
          row.original.totalStaked >= row.original.maxStake ||
          row.original.numPools == 0

        return (
          <div className="flex items-center gap-x-2">
            <Button size="sm" disabled={stakingDisabled}>
              Stake
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem disabled={stakingDisabled}>Stake</DropdownMenuItem>
                  <DropdownMenuItem disabled={stakingDisabled}>Restake</DropdownMenuItem>
                  <DropdownMenuItem disabled={stakingDisabled}>Unstake</DropdownMenuItem>
                  <DropdownMenuItem disabled={stakingDisabled}>Claim rewards</DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <Link
                      to="/validators/$validatorId"
                      params={{ validatorId: row.original.id.toString() }}
                    >
                      View Details
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
      size: 120,
    },
  ]

  // if (!data) {
  //   return null
  // }

  return (
    <DataTable
      columns={columns}
      data={validators}
      // columnPinningState={{ left: ['id', 'validator'], right: [] }}
      // columnPinningThreshold="lg"
    />
  )
}
