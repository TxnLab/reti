import { useQueryClient } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'
import {
  ColumnDef,
  ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  VisibilityState,
} from '@tanstack/react-table'
import { useWallet } from '@txnlab/use-wallet-react'
import { Ban, FlaskConical, MoreHorizontal, Sunset } from 'lucide-react'
import * as React from 'react'
import { AddStakeModal } from '@/components/AddStakeModal'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'
import { ClaimTokens } from '@/components/ClaimTokens'
import { DataTableColumnHeader } from '@/components/DataTableColumnHeader'
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
import { useAuthAddress } from '@/providers/AuthAddressProvider'
import {
  calculateRewardEligibility,
  canManageValidator,
  isStakingDisabled,
  isSunsetted,
  isSunsetting,
  isUnstakingDisabled,
} from '@/utils/contracts'
import { dayjs } from '@/utils/dayjs'
import { simulateEpoch } from '@/utils/development'
import { ellipseAddressJsx } from '@/utils/ellipseAddress'
import { formatAssetAmount } from '@/utils/format'
import { globalFilterFn } from '@/utils/table'
import { cn } from '@/utils/ui'

interface StakingTableProps {
  validators: Validator[]
  stakesByValidator: StakerValidatorData[]
  isLoading: boolean
  constraints: Constraints
}

export function StakingTable({
  validators,
  stakesByValidator,
  isLoading,
  constraints,
}: StakingTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})

  const [addStakeValidator, setAddStakeValidator] = React.useState<Validator | null>(null)
  const [unstakeValidator, setUnstakeValidator] = React.useState<Validator | null>(null)

  const { transactionSigner, activeAddress } = useWallet()
  const { authAddress } = useAuthAddress()

  const router = useRouter()
  const queryClient = useQueryClient()

  const columns: ColumnDef<StakerValidatorData>[] = [
    {
      id: 'validator',
      accessorFn: (row) => row.validatorId,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Validator" />,
      cell: ({ row }) => {
        const validator = validators.find((v) => v.id === row.original.validatorId)

        if (!validator) {
          return 'Unknown Validator'
        }

        const nfdAppId = validator.config.nfdForInfo
        return (
          <div className="flex items-center gap-x-2">
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
                validatorId: String(row.original.validatorId),
              }}
              className="link underline-offset-4"
            >
              {nfdAppId > 0 ? (
                <NfdThumbnail nameOrId={nfdAppId} />
              ) : (
                <span className="font-mono whitespace-nowrap">
                  {ellipseAddressJsx(validator.config.owner)}
                </span>
              )}
            </Link>
          </div>
        )
      },
    },
    {
      accessorKey: 'balance',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Balance" />,
      cell: ({ row }) => (
        <AlgoDisplayAmount
          amount={row.original.balance}
          microalgos
          mutedRemainder
          className="font-mono"
        />
      ),
    },
    {
      accessorKey: 'totalRewarded',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total Rewarded" />,
      cell: ({ row }) => (
        <AlgoDisplayAmount
          amount={row.original.totalRewarded}
          microalgos
          mutedRemainder
          className="font-mono"
        />
      ),
    },
    {
      accessorKey: 'rewardTokenBalance',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Token Balance" />,
      cell: ({ row }) => {
        const validator = validators.find((v) => v.id === row.original.validatorId)
        if (!validator?.rewardToken) {
          return <span className="text-muted-foreground">--</span>
        }
        return (
          <span className="font-mono">
            {formatAssetAmount(validator.rewardToken, row.original.rewardTokenBalance, {
              unitName: true,
            })}
          </span>
        )
      },
    },
    {
      accessorKey: 'nextEpochEligible',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Reward Eligibility" />,
      cell: ({ row }) => {
        const stakerValidatorData = row.original
        const validator = validators.find((v) => v.id === stakerValidatorData.validatorId)
        const { epochRoundLength } = validator?.config || {}

        const allPoolsEligibility = stakerValidatorData.pools.map((poolData) => {
          const eligibility = calculateRewardEligibility(
            epochRoundLength,
            poolData.lastPayout,
            poolData.entryRound,
          )
          return eligibility
        })

        // Take last pool's eligibility %
        const lastPoolEligibility = allPoolsEligibility.pop()
        return (
          <span className="whitespace-nowrap">
            {lastPoolEligibility !== null ? `${lastPoolEligibility || 0}%` : '--'}
          </span>
        )
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const validatorId = row.original.validatorId
        const validator = validators.find((v) => v.id === validatorId)

        if (!validator || !activeAddress) return null

        const stakingDisabled = isStakingDisabled(activeAddress, validator, constraints)
        const unstakingDisabled = isUnstakingDisabled(activeAddress, validator, stakesByValidator)
        const canManage = canManageValidator(activeAddress, validator)

        const isDevelopment = process.env.NODE_ENV === 'development'
        const canSimulateEpoch = isDevelopment && canManage

        return (
          <div className="flex items-center justify-end gap-x-2 ml-2">
            <Button
              size="sm"
              className={cn({ hidden: isSunsetted(validator) })}
              onClick={() => setAddStakeValidator(validator)}
              disabled={stakingDisabled}
            >
              Stake
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setUnstakeValidator(validator)}
              disabled={unstakingDisabled}
            >
              Unstake
            </Button>

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

                  {validator.rewardToken && (
                    <ClaimTokens
                      validator={validator}
                      rewardTokenBalance={row.original.rewardTokenBalance}
                    />
                  )}
                </DropdownMenuGroup>

                {canSimulateEpoch && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onClick={async () => {
                          await simulateEpoch(
                            validator,
                            row.original.pools,
                            100,
                            transactionSigner,
                            activeAddress,
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
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
    },
  ]

  const table = useReactTable({
    data: stakesByValidator,
    columns,
    filterFns: {
      global: globalFilterFn,
    },
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
    },
  })

  return (
    <>
      <div>
        <div className="lg:flex items-center gap-x-2 py-3">
          <h2 className="mb-2 text-lg font-semibold lg:flex-1 lg:my-1">My Stakes</h2>
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
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className={cn('first:px-4')}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    {isLoading ? 'Loading...' : 'No results'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* {table.getFilteredRowModel().rows.length > 0 && (
          <div className="flex items-center justify-end space-x-2 py-4">
            <div className="flex-1 text-sm text-muted-foreground">
              {table.getFilteredSelectedRowModel().rows.length} of{' '}
              {table.getFilteredRowModel().rows.length} row(s) selected.
            </div>
          </div>
        )} */}
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
    </>
  )
}
