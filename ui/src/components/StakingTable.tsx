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
import dayjs from 'dayjs'
import * as React from 'react'
import { AlgoDisplayAmount } from '@/components/AlgoDisplayAmount'
import { DataTableColumnHeader } from '@/components/DataTableColumnHeader'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ValidatorStake } from '@/interfaces/staking'
import { cn } from '@/utils/ui'

interface StakingTableProps {
  delegations: ValidatorStake[]
  isLoading: boolean
}

export function StakingTable({ delegations, isLoading }: StakingTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = React.useState({})

  const columns: ColumnDef<ValidatorStake>[] = [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          className={cn(isLoading ? 'invisible' : '')}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'validatorId',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Validator ID" />,
      cell: ({ row }) => row.original.poolKey.validatorId,
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
      cell: ({ row }) => dayjs.unix(row.original.entryTime).format('lll'),
    },
    {
      id: 'actions',
      cell: () => {
        return (
          <div className="flex items-center justify-end gap-x-2">
            <Button size="sm">Claim</Button>
            <Button size="sm" variant="outline">
              Unstake
            </Button>
          </div>
        )
      },
    },
  ]

  const table = useReactTable({
    data: delegations,
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
  )
}
