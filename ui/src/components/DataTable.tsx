import {
  // Column,
  ColumnDef,
  ColumnFiltersState,
  // ColumnPinningState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import * as React from 'react'
import { DataTableViewOptions } from '@/components/DataTableViewOptions'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/utils/ui'

// const defaultColumnPinning: ColumnPinningState = {
//   left: [],
//   right: [],
// }

// type PinningThreshold = 'sm' | 'md' | 'lg' | 'xl' | undefined

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  // columnPinningState?: ColumnPinningState
  // columnPinningThreshold?: PinningThreshold
}

export function DataTable<TData, TValue>({
  columns,
  data,
  // columnPinningState = defaultColumnPinning,
  // columnPinningThreshold,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  // const [columnPinning, setColumnPinning] = React.useState<ColumnPinningState>(columnPinningState)
  const [rowSelection, setRowSelection] = React.useState({})

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    // onColumnPinningChange: setColumnPinning,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      // columnPinning,
      rowSelection,
    },
  })

  // const getPinningStyles = (column: Column<TData>): React.CSSProperties => {
  //   const isPinned = column.getIsPinned()

  //   return {
  //     left: isPinned === 'left' ? `${column.getStart('left')}px` : undefined,
  //     right: isPinned === 'right' ? `${column.getAfter('right')}px` : undefined,
  //     opacity: isPinned ? 0.95 : 1,
  //     width: column.getSize(),
  //   }
  // }

  // const getPinningThreshold = (breakpoint: 'sm' | 'md' | 'lg' | 'xl' | undefined) => {
  //   switch (breakpoint) {
  //     case 'sm':
  //       return 'sm:relative sm:z-auto sm:bg-transparent sm:rounded-none'
  //     case 'md':
  //       return 'md:relative md:z-auto md:bg-transparent md:rounded-none'
  //     case 'lg':
  //       return 'lg:relative lg:z-auto lg:bg-transparent lg:rounded-none'
  //     case 'xl':
  //       return 'xl:relative xl:z-auto xl:bg-transparent xl:rounded-none'
  //     default:
  //       return ''
  //   }
  // }

  return (
    <div>
      <div className="flex items-center py-4">
        <Input
          placeholder="Filter validators..."
          value={(table.getColumn('validator')?.getFilterValue() as string) ?? ''}
          onChange={(event) => table.getColumn('validator')?.setFilterValue(event.target.value)}
          className="max-w-sm"
        />
        <DataTableViewOptions table={table} />
      </div>
      <div className="rounded-md border">
        <Table className="border-collapse border-spacing-0">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        'first:px-4',
                        // header.column.getIsPinned()
                        //   ? // eslint-disable-next-line prefer-template
                        //     'sticky z-[1] bg-background rounded-md ' +
                        //       getPinningThreshold(columnPinningThreshold)
                        //   : 'relative',
                      )}
                      // style={{ ...getPinningStyles(header.column) }}
                    >
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
                    <TableCell
                      key={cell.id}
                      className={cn(
                        'first:px-4',
                        // cell.column.getIsPinned()
                        //   ? // eslint-disable-next-line prefer-template
                        //     'sticky z-[1] bg-background rounded-md ' +
                        //       getPinningThreshold(columnPinningThreshold)
                        //   : 'relative',
                      )}
                      // style={{ ...getPinningStyles(cell.column) }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
