import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Link } from '@tanstack/react-router'
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
import { MoreHorizontal } from 'lucide-react'
import * as React from 'react'
import { AddStakeModal } from '@/components/AddStakeModal'
import { DataTableColumnHeader } from '@/components/DataTableColumnHeader'
import { DataTableViewOptions } from '@/components/DataTableViewOptions'
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
import { Validator } from '@/interfaces/validator'
import { formatDuration } from '@/utils/dayjs'
import { ellipseAddress } from '@/utils/ellipseAddress'
import { cn } from '@/utils/ui'

interface ValidatorTableProps {
  validators: Validator[]
}

export function ValidatorTable({ validators }: ValidatorTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = React.useState({})

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
      id: 'minEntry',
      accessorFn: (row) => row.minStake,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Min Entry" />,
      cell: ({ row }) => {
        const amount = parseFloat(row.getValue('minEntry'))
        const algoAmount = AlgoAmount.MicroAlgos(amount).algos
        const formatted = new Intl.NumberFormat('en-US', { notation: 'compact' }).format(algoAmount)

        return formatted
      },
    },
    {
      id: 'stake',
      accessorFn: (row) => row.totalStaked,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Stake" />,
      cell: ({ row }) => {
        const currentStake = AlgoAmount.MicroAlgos(Number(row.original.totalStaked)).algos
        const currentStakeFormatted = new Intl.NumberFormat('en-US', {
          notation: 'compact',
        }).format(currentStake)

        const maxStake = AlgoAmount.MicroAlgos(Number(row.original.maxStake)).algos
        const maxStakeFormatted = new Intl.NumberFormat('en-US', {
          notation: 'compact',
        }).format(maxStake)

        return (
          <span>
            {currentStakeFormatted} / {maxStakeFormatted}
          </span>
        )
      },
    },
    {
      id: 'stakers',
      accessorFn: (row) => row.numStakers,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Stakers" />,
      cell: ({ row }) => {
        const validator = row.original

        if (validator.numPools == 0) return '--'

        const numStakers = validator.numStakers
        const maxStakers = 200

        return (
          <span>
            {numStakers} / {maxStakers}
          </span>
        )
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
        return <span className="capitalize">{formatDuration(minutes)}</span>
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
          <div className="flex items-center justify-end gap-x-2">
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
    <div>
      <div className="lg:flex items-center lg:gap-x-2 py-4">
        <h2 className="mb-2 text-lg font-semibold lg:flex-1 lg:my-1">All Validators</h2>
        {table.getFilteredRowModel().rows.length > 0 && (
          <div className="flex items-center gap-x-3">
            <Input
              placeholder="Filter validators..."
              value={(table.getColumn('validator')?.getFilterValue() as string) ?? ''}
              onChange={(event) => table.getColumn('validator')?.setFilterValue(event.target.value)}
              className="sm:max-w-sm lg:w-64"
            />
            <DataTableViewOptions table={table} className="h-9" />
          </div>
        )}
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
                  No results
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
