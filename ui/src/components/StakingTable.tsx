import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
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
import { useWallet } from '@txnlab/use-wallet'
import dayjs from 'dayjs'
import { FlaskConical, MoreHorizontal } from 'lucide-react'
import * as React from 'react'
import { AddStakeModal } from '@/components/AddStakeModal'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'
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
import { Validator } from '@/interfaces/validator'
import { canManageValidator, isStakingDisabled, isUnstakingDisabled } from '@/utils/contracts'
import { simulateEpoch } from '@/utils/development'
import { cn } from '@/utils/ui'

interface StakingTableProps {
  validators: Validator[]
  stakesByValidator: StakerValidatorData[]
  isLoading: boolean
}

export function StakingTable({ validators, stakesByValidator, isLoading }: StakingTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = React.useState({})

  const [addStakeValidator, setAddStakeValidator] = React.useState<Validator | null>(null)
  const [unstakeValidator, setUnstakeValidator] = React.useState<Validator | null>(null)

  const { signer, activeAddress } = useWallet()

  const router = useRouter()
  const queryClient = useQueryClient()

  const columns: ColumnDef<StakerValidatorData>[] = [
    // {
    //   id: 'select',
    //   header: ({ table }) => (
    //     <Checkbox
    //       checked={
    //         table.getIsAllPageRowsSelected() ||
    //         (table.getIsSomePageRowsSelected() && 'indeterminate')
    //       }
    //       onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
    //       className={cn(isLoading ? 'invisible' : 'mr-2')}
    //       aria-label="Select all"
    //     />
    //   ),
    //   cell: ({ row }) => (
    //     <Checkbox
    //       checked={row.getIsSelected()}
    //       onCheckedChange={(value) => row.toggleSelected(!!value)}
    //       aria-label="Select row"
    //       className="mr-2"
    //     />
    //   ),
    //   enableSorting: false,
    //   enableHiding: false,
    // },
    {
      accessorKey: 'validatorId',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Validator" />,
      cell: ({ row }) => row.original.validatorId,
      size: 100,
    },
    {
      accessorKey: 'balance',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Balance" />,
      cell: ({ row }) => (
        <AlgoDisplayAmount amount={row.original.balance} microalgos mutedRemainder />
      ),
    },
    {
      accessorKey: 'totalRewarded',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total Rewards" />,
      cell: ({ row }) => (
        <AlgoDisplayAmount amount={row.original.totalRewarded} microalgos mutedRemainder />
      ),
    },
    // {
    //   accessorKey: 'rewardTokenBalance',
    //   header: ({ column }) => (
    //     <DataTableColumnHeader column={column} title="Reward Token Balance" />
    //   ),
    //   cell: ({ row }) => row.original.rewardTokenBalance,
    // },
    {
      accessorKey: 'entryTime',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Entry Time" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {dayjs.unix(row.original.entryTime).format('lll')}
        </span>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const validatorId = row.original.validatorId
        const validator = validators.find((v) => v.id === validatorId)

        if (!validator || !activeAddress) return null

        const stakingDisabled = isStakingDisabled(validator)
        const unstakingDisabled = isUnstakingDisabled(validator, stakesByValidator)
        const canManage = canManageValidator(validator, activeAddress!)

        return (
          <div className="flex items-center justify-end gap-x-2 ml-2">
            <Button
              size="sm"
              onClick={() => setAddStakeValidator(validator)}
              disabled={stakingDisabled}
            >
              Stake
            </Button>
            <Button size="sm" variant="outline" onClick={() => setUnstakeValidator(validator)}>
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
                </DropdownMenuGroup>

                {process.env.NODE_ENV === 'development' && canManage && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onClick={async () =>
                          await simulateEpoch(
                            validator,
                            row.original.pools,
                            100,
                            signer,
                            activeAddress,
                            queryClient,
                            router,
                          )
                        }
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
        <div className="lg:flex items-center gap-x-2 py-4">
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

        {table.getFilteredRowModel().rows.length > 0 && (
          <div className="flex items-center justify-end space-x-2 py-4">
            <div className="flex-1 text-sm text-muted-foreground">
              {table.getFilteredSelectedRowModel().rows.length} of{' '}
              {table.getFilteredRowModel().rows.length} row(s) selected.
            </div>
          </div>
        )}
      </div>

      <AddStakeModal validator={addStakeValidator} setValidator={setAddStakeValidator} />
      <UnstakeModal
        validator={unstakeValidator}
        setValidator={setUnstakeValidator}
        stakesByValidator={stakesByValidator}
      />
    </>
  )
}
