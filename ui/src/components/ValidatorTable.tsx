import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Link } from '@tanstack/react-router'
import { ColumnDef } from '@tanstack/react-table'
import { useWallet } from '@txnlab/use-wallet'
import { MoreHorizontal } from 'lucide-react'
import { AddStakeModal } from '@/components/AddStakeModal'
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
  const { activeAddress } = useWallet()

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
        const validator = row.original

        const nfdAppId = validator.nfd
        if (nfdAppId > 0) {
          return ellipseAddress(validator.owner) // @todo: fetch NFD by appId
        }
        return ellipseAddress(validator.owner)
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
        const validator = row.original

        if (validator.numPools == 0) return '--'
        const maxStakers = 100
        const spacesLeft = maxStakers - validator.numStakers
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
        const validator = row.original

        const stakingDisabled =
          validator.numStakers >= 100 ||
          validator.totalStaked >= validator.maxStake ||
          validator.numPools == 0

        const isOwner = validator.owner === activeAddress
        const isManager = validator.manager === activeAddress
        const canEdit = isOwner || isManager

        return (
          <div className="flex items-center gap-x-2">
            <AddStakeModal validator={validator} disabled={stakingDisabled} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
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
                      params={{ validatorId: validator.id.toString() }}
                    >
                      {canEdit ? 'Manage' : 'View'}
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

  return <DataTable columns={columns} data={validators} />
}
