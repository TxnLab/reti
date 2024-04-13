import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useWallet } from '@txnlab/use-wallet-react'
import { FlaskConical, MoreHorizontal } from 'lucide-react'
import * as React from 'react'
import { AddPoolModal } from '@/components/AddPoolModal'
import { AddStakeModal } from '@/components/AddStakeModal'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'
import { DataTableColumnHeader } from '@/components/DataTableColumnHeader'
import { DataTableViewOptions } from '@/components/DataTableViewOptions'
import { NfdThumbnail } from '@/components/NfdThumbnail'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { UnstakeModal } from '@/components/UnstakeModal'
import { StakerValidatorData } from '@/interfaces/staking'
import { Constraints, Validator } from '@/interfaces/validator'
import {
  calculateMaxStake,
  calculateMaxStakers,
  canManageValidator,
  isAddingPoolDisabled,
  isStakingDisabled,
  isUnstakingDisabled,
} from '@/utils/contracts'
import { formatDuration } from '@/utils/dayjs'
import { sendRewardTokensToPool } from '@/utils/development'
import { ellipseAddress } from '@/utils/ellipseAddress'
import { cn } from '@/utils/ui'
import { ValidatorRewards } from '@/components/ValidatorRewards'

interface ValidatorTableProps {
  validators: Validator[]
  stakesByValidator: StakerValidatorData[]
  constraints: Constraints
}

export function ValidatorTable({
  validators,
  stakesByValidator,
  constraints,
}: ValidatorTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = React.useState({})

  const [addStakeValidator, setAddStakeValidator] = React.useState<Validator | null>(null)
  const [unstakeValidator, setUnstakeValidator] = React.useState<Validator | null>(null)
  const [addPoolValidator, setAddPoolValidator] = React.useState<Validator | null>(null)

  const { transactionSigner, activeAddress } = useWallet()
  const navigate = useNavigate()

  const columns: ColumnDef<Validator>[] = [
    {
      id: 'validator',
      accessorFn: (row) => row.nfd?.name || row.config.owner.toLowerCase(),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Validator" />,
      cell: ({ row }) => {
        const validator = row.original
        const nfd = validator.nfd

        return (
          <div className="flex min-w-0 max-w-[9rem]">
            <Link
              to="/validators/$validatorId"
              params={{
                validatorId: String(validator.id),
              }}
              className="truncate hover:underline underline-offset-4"
              onClick={(e) => e.stopPropagation()}
            >
              {nfd ? (
                <NfdThumbnail nfd={nfd} truncate tooltip />
              ) : (
                ellipseAddress(validator.config.owner)
              )}
            </Link>
          </div>
        )
      },
    },
    {
      id: 'minEntry',
      accessorFn: (row) => Number(row.config.minEntryStake),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Min Entry" />,
      cell: ({ row }) => {
        const validator = row.original
        return <AlgoDisplayAmount amount={validator.config.minEntryStake} microalgos />
      },
    },
    {
      id: 'stake',
      accessorFn: (row) => Number(row.state.totalAlgoStaked),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Stake" />,
      cell: ({ row }) => {
        const validator = row.original

        if (validator.state.numPools === 0) return '--'

        const currentStake = AlgoAmount.MicroAlgos(Number(validator.state.totalAlgoStaked)).algos
        const currentStakeCompact = new Intl.NumberFormat(undefined, {
          notation: 'compact',
        }).format(currentStake)

        const maxStake = calculateMaxStake(validator, constraints, true)
        const maxStakeCompact = new Intl.NumberFormat(undefined, {
          notation: 'compact',
        }).format(maxStake)

        return (
          <span className="whitespace-nowrap">
            {currentStakeCompact} / {maxStakeCompact}
          </span>
        )
      },
    },
    {
      id: 'pools',
      accessorFn: (row) => row.state.numPools,
      header: ({ column }) => <DataTableColumnHeader column={column} title="# Pools" />,
      cell: ({ row }) => {
        const validator = row.original
        const { poolsPerNode } = validator.config
        const maxNodes = constraints.maxNodes

        // if (validator.state.numPools === 0) return '--'
        return (
          <span className="whitespace-nowrap">
            {validator.state.numPools} / {poolsPerNode * maxNodes}
          </span>
        )
      },
    },
    {
      id: 'stakers',
      accessorFn: (row) => row.state.totalStakers,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Stakers" />,
      cell: ({ row }) => {
        const validator = row.original

        if (validator.state.numPools == 0) return '--'

        const totalStakers = validator.state.totalStakers
        const maxStakers = calculateMaxStakers(validator, constraints)

        return (
          <span className="whitespace-nowrap">
            {totalStakers} / {maxStakers}
          </span>
        )
      },
    },
    {
      id: 'reward',
      accessorFn: (row) => row.state.totalStakers,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Reward Avail" />,
      cell: ({ row }) => {
        const validator = row.original
        if (validator.state.numPools == 0) return '--'

        return <ValidatorRewards validator={validator} />
      },
    },
    {
      id: 'commission',
      accessorFn: (row) => row.config.percentToValidator,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Commission" />,
      cell: ({ row }) => {
        const validator = row.original
        const percent = validator.config.percentToValidator / 10000
        return `${percent}%`
      },
    },
    {
      id: 'payoutFrequency',
      accessorFn: (row) => row.config.payoutEveryXMins,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Payout Frequency" />,
      cell: ({ row }) => {
        const validator = row.original
        const frequencyFormatted = formatDuration(validator.config.payoutEveryXMins)
        return <span className="capitalize">{frequencyFormatted}</span>
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const validator = row.original
        const stakingDisabled = isStakingDisabled(activeAddress, validator, constraints)
        const unstakingDisabled = isUnstakingDisabled(activeAddress, validator, stakesByValidator)
        const addingPoolDisabled = isAddingPoolDisabled(activeAddress, validator, constraints)
        const canManage = canManageValidator(activeAddress, validator)

        const isDevelopment = process.env.NODE_ENV === 'development'
        const hasRewardToken = validator.config.rewardTokenId > 0
        const canSendRewardTokens = isDevelopment && canManage && hasRewardToken
        const sendRewardTokensDisabled = validator.state.numPools === 0

        return (
          <div className="flex items-center justify-end gap-x-2">
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                setAddStakeValidator(validator)
              }}
              disabled={stakingDisabled}
            >
              Stake
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() => setAddStakeValidator(validator)}
                    disabled={stakingDisabled}
                  >
                    Stake
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setUnstakeValidator(validator)}
                    disabled={unstakingDisabled}
                  >
                    Unstake
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <Link
                      to="/validators/$validatorId"
                      params={{ validatorId: validator.id.toString() }}
                    >
                      {canManage ? 'Manage' : 'View'}
                    </Link>
                  </DropdownMenuItem>
                  {canManage && (
                    <DropdownMenuItem
                      onClick={() => setAddPoolValidator(validator)}
                      disabled={addingPoolDisabled}
                    >
                      Add Staking Pool
                    </DropdownMenuItem>
                  )}

                  {canSendRewardTokens && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onClick={async () =>
                            await sendRewardTokensToPool(
                              validator,
                              5000,
                              transactionSigner,
                              activeAddress!,
                            )
                          }
                          disabled={sendRewardTokensDisabled}
                        >
                          <FlaskConical className="h-4 w-4 mr-2 text-muted-foreground" />
                          Send Tokens
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </>
                  )}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
      size: 120,
    },
  ]

  const table = useReactTable({
    data: validators,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
  })

  return (
    <>
      <div>
        <div className="lg:flex items-center lg:gap-x-2 py-3">
          <h2 className="mb-2 text-lg font-semibold lg:flex-1 lg:my-1">All Validators</h2>
          <div className="flex items-center gap-x-3">
            <Input
              placeholder="Filter validators..."
              value={(table.getColumn('validator')?.getFilterValue() as string) ?? ''}
              onChange={(event) => table.getColumn('validator')?.setFilterValue(event.target.value)}
              className="sm:max-w-sm lg:w-64"
            />
            <DataTableViewOptions table={table} className="h-9" />
          </div>
        </div>
        <div className="rounded-md border">
          <Table className="border-collapse border-spacing-0">
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead key={header.id} className={cn('first:px-4')}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && 'selected'}
                    onClick={async () =>
                      await navigate({
                        to: `/validators/$validatorId`,
                        params: { validatorId: row.original.id.toString() },
                      })
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className={cn('cursor-pointer first:px-4')}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    No results
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <AddStakeModal
        validator={addStakeValidator}
        setValidator={setAddStakeValidator}
        constraints={constraints}
      />
      <UnstakeModal
        validator={unstakeValidator}
        setValidator={setUnstakeValidator}
        stakesByValidator={stakesByValidator}
      />
      <AddPoolModal validator={addPoolValidator} setValidator={setAddPoolValidator} />
    </>
  )
}
