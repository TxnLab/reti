import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { NodeInfo } from '@/interfaces/validator'

interface NodeSelectProps {
  nodesInfo: NodeInfo[]
  value: string
  onValueChange: (value: string) => void
}

export function NodeSelect({ nodesInfo, value, onValueChange }: NodeSelectProps) {
  return (
    <Select onValueChange={onValueChange} value={value}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Select a node" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {nodesInfo.map(({ index, availableSlots }) => (
            <SelectItem key={index} value={index.toString()} disabled={availableSlots === 0}>
              Node {index}{' '}
              <span className="text-muted-foreground">
                (
                {availableSlots === 0
                  ? 'no slots remaining'
                  : `${availableSlots} slot${availableSlots > 1 ? 's' : ''}`}
                )
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
