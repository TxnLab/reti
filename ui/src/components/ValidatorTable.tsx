import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  Updater,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useWallet } from '@txnlab/use-wallet-react'
import { Ban, ChevronRight, FlaskConical, MoreHorizontal, Sunset } from 'lucide-react'
import * as React from 'react'
import { AddPoolModal } from '@/components/AddPoolModal'
import { AddStakeModal } from '@/components/AddStakeModal'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'
import { AlgoSymbol } from '@/components/AlgoSymbol'
import { DataTableColumnHeader } from '@/components/DataTableColumnHeader'
import { DataTableViewOptions } from '@/components/DataTableViewOptions'
import { NfdThumbnail } from '@/components/NfdThumbnail'
import { Tooltip } from '@/components/Tooltip'
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
import { ValidatorInfoRow } from '@/components/ValidatorInfoRow'
import { ValidatorRewards } from '@/components/ValidatorRewards'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { StakerValidatorData } from '@/interfaces/staking'
import { Constraints, Validator } from '@/interfaces/validator'
import { useAuthAddress } from '@/providers/AuthAddressProvider'
import {
  calculateMaxStake,
  canManageValidator,
  isAddingPoolDisabled,
  isStakingDisabled,
  isSunsetted,
  isSunsetting,
  isUnstakingDisabled,
} from '@/utils/contracts'
import { dayjs } from '@/utils/dayjs'
import { sendRewardTokensToPool, simulateEpoch } from '@/utils/development'
import { ellipseAddressJsx } from '@/utils/ellipseAddress'
import { formatAmount, formatAssetAmount } from '@/utils/format'
import { cn } from '@/utils/ui'

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
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [rowSelection, setRowSelection] = React.useState({})

  const [addStakeValidator, setAddStakeValidator] = React.useState<Validator | null>(null)
  const [unstakeValidator, setUnstakeValidator] = React.useState<Validator | null>(null)
  const [addPoolValidator, setAddPoolValidator] = React.useState<Validator | null>(null)

  const { transactionSigner, activeAddress } = useWallet()
  const { authAddress } = useAuthAddress()

  const router = useRouter()
  const queryClient = useQueryClient()

  const [sorting, setSorting] = useLocalStorage<SortingState>('validator-sorting', [
    { id: 'stake', desc: true },
  ])

  const handleSortingChange = (updaterOrValue: Updater<SortingState>) => {
    if (typeof updaterOrValue === 'function') {
      const newState = updaterOrValue(sorting)
      setSorting(newState)
    } else {
      setSorting(updaterOrValue)
    }
  }

  const [columnVisibility, setColumnVisibility] = useLocalStorage<VisibilityState>(
    'validator-columns',
    {},
  )
  const handleColumnVisibilityChange = (updaterOrValue: Updater<VisibilityState>) => {
    if (typeof updaterOrValue === 'function') {
      const newState = updaterOrValue(columnVisibility)
      setColumnVisibility(newState)
    } else {
      setColumnVisibility(updaterOrValue)
    }
  }

  const columns: ColumnDef<Validator>[] = [
    {
      id: 'expander',
      header: () => null,
      cell: ({ row }) => {
        return row.getCanExpand() ? (
          <button
            data-state={row.getIsExpanded() ? 'open' : 'closed'}
            className="m-0 p-2 cursor-pointer [&[data-state=open]>svg]:rotate-90"
            {...{
              onClick: row.getToggleExpandedHandler(),
            }}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        ) : (
          <>&nbsp;</>
        )
      },
    },
    {
      id: 'validator',
      accessorFn: (row) => row.nfd?.name || row.config.owner.toLowerCase(),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Validator" />,
      cell: ({ row }) => {
        const validator = row.original
        const nfd = validator.nfd

        return (
          <div className="flex items-center gap-x-2 min-w-0 max-w-[10rem] xl:max-w-[16rem]">
            {isSunsetted(validator) ? (
              <Tooltip
                content={`Sunset on ${dayjs.unix(validator.config.sunsettingOn).format('ll')}`}
              >
                <Ban className="h-5 w-5 text-muted-foreground transition-colors" />
              </Tooltip>
            ) : isSunsetting(validator) ? (
              <Tooltip
                content={`Will sunset on ${dayjs.unix(validator.config.sunsettingOn).format('ll')}`}
              >
                <Sunset className="h-5 w-5 text-muted-foreground transition-colors" />
              </Tooltip>
            ) : null}
            <Link
              to="/validators/$validatorId"
              params={{
                validatorId: String(validator.id),
              }}
              className={cn('link underline-offset-4', { truncate: !!nfd })}
              preload="intent"
            >
              {nfd ? (
                <NfdThumbnail
                  nfd={nfd}
                  truncate
                  tooltip
                  className={cn(isSunsetted(validator) ? 'opacity-50' : '')}
                />
              ) : (
                <span className="font-mono">{ellipseAddressJsx(validator.config.owner)}</span>
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

        const currentStakeAlgos = AlgoAmount.MicroAlgos(
          Number(validator.state.totalAlgoStaked),
        ).algos
        const currentStakeCompact = new Intl.NumberFormat(undefined, {
          notation: 'compact',
        }).format(currentStakeAlgos)

        const maxStake = calculateMaxStake(validator, constraints)
        const maxStakeAlgos = AlgoAmount.MicroAlgos(Number(maxStake)).algos
        const maxStakeCompact = new Intl.NumberFormat(undefined, {
          notation: 'compact',
        }).format(maxStakeAlgos)

        return (
          <span className="whitespace-nowrap">
            <AlgoSymbol />
            {currentStakeCompact} / {maxStakeCompact}
          </span>
        )
      },
    },
    {
      id: 'apy',
      accessorFn: (row) => row.apy,
      header: ({ column }) => <DataTableColumnHeader column={column} title="APY" />,
      cell: ({ row }) => {
        if (!row.original.apy) return <span className="text-muted-foreground">--</span>
        return <span>{formatAmount(row.original.apy, { precision: 3 })}%</span>
      },
    },
    {
      id: 'reward',
      accessorFn: (row) => row.state.totalStakers, // @todo: fix this
      header: ({ column }) => <DataTableColumnHeader column={column} title="Avail. Rewards" />,
      cell: ({ row }) => {
        const validator = row.original
        if (validator.state.numPools == 0) return '--'

        return <ValidatorRewards validator={validator} />
      },
    },
    {
      id: 'token',
      accessorFn: (row) => row.config.rewardTokenId,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Token" />,
      cell: ({ row }) => {
        const validator = row.original
        if (!validator.rewardToken) {
          return <span className="text-muted-foreground">--</span>
        }

        const perEpochAmount = formatAssetAmount(
          validator.rewardToken,
          validator.config.rewardPerPayout,
          { unitName: true },
        )

        const tooltipContent = `${perEpochAmount} per epoch`

        return (
          <Tooltip content={tooltipContent}>
            <span className="font-mono">{validator.rewardToken.params['unit-name']}</span>
          </Tooltip>
        )
      },
    },
    {
      id: 'fee',
      accessorFn: (row) => row.config.percentToValidator,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Fee" />,
      cell: ({ row }) => {
        const validator = row.original
        const percent = validator.config.percentToValidator / 10000
        return `${percent}%`
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

        const stakerValidatorData = stakesByValidator.find(
          (data) => data.validatorId === validator.id,
        )
        const stakerPoolData = stakerValidatorData?.pools
        const canSimulateEpoch = isDevelopment && canManage && !!stakerPoolData

        return (
          <div className="flex items-center justify-end gap-x-2">
            {isSunsetting(validator) && !unstakingDisabled ? (
              <Button size="sm" variant="secondary" onClick={() => setUnstakeValidator(validator)}>
                Unstake
              </Button>
            ) : (
              <Button
                size="sm"
                className={cn({ hidden: stakingDisabled })}
                onClick={() => setAddStakeValidator(validator)}
              >
                Stake
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
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

                  {canManage && (
                    <DropdownMenuItem
                      onClick={() => setAddPoolValidator(validator)}
                      disabled={addingPoolDisabled}
                    >
                      Add Staking Pool
                    </DropdownMenuItem>
                  )}

                  {canSimulateEpoch && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onClick={async () => {
                            await simulateEpoch(
                              validator,
                              stakerPoolData,
                              100,
                              transactionSigner,
                              activeAddress!,
                              authAddress,
                              queryClient,
                              router,
                            )
                          }}
                          disabled={unstakingDisabled}
                        >
                          <FlaskConical className="h-4 w-4 mr-2 text-muted-foreground" />
                          Simulate Epoch
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </>
                  )}

                  {canSendRewardTokens && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onClick={async () => {
                            await sendRewardTokensToPool(
                              validator,
                              5000,
                              transactionSigner,
                              activeAddress!,
                            )
                          }}
                          disabled={sendRewardTokensDisabled}
                        >
                          <FlaskConical className="h-4 w-4 mr-2 text-muted-foreground" />
                          Send Tokens
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <Link
                      to="/validators/$validatorId"
                      params={{ validatorId: validator.id.toString() }}
                      preload="intent"
                    >
                      {canManage ? 'Manage' : 'View'}
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

  const table = useReactTable({
    data: validators,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: handleSortingChange,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: handleColumnVisibilityChange,
    onRowSelectionChange: setRowSelection,
    getRowCanExpand: () => true,
    getExpandedRowModel: getExpandedRowModel(),
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
                      <TableHead key={header.id} className="first:px-0 first:w-12">
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
                  <React.Fragment key={row.id}>
                    <TableRow
                      data-state={row.getIsSelected() && 'selected'}
                      className={cn({
                        'text-foreground/50': isSunsetted(row.original),
                        'border-b-0 bg-muted/25': row.getIsExpanded(),
                      })}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="first:pr-0">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                    {row.getIsExpanded() && (
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableCell colSpan={row.getVisibleCells().length} className="p-0">
                          <ValidatorInfoRow validator={row.original} constraints={constraints} />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
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
        stakesByValidator={stakesByValidator}
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
