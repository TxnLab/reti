import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { NodePoolAssignmentConfig } from '@/interfaces/validator'
import { processNodePoolAssignment } from '@/utils/contracts'

interface NodeSelectProps {
  nodes: NodePoolAssignmentConfig
  poolsPerNode: number
  onValueChange: (value: string) => void
  defaultValue: string
}

export function NodeSelect({ nodes, poolsPerNode, onValueChange, defaultValue }: NodeSelectProps) {
  const nodeInfo = processNodePoolAssignment(nodes, poolsPerNode)

  return (
    <Select onValueChange={onValueChange} defaultValue={defaultValue}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Select a node" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {nodeInfo.map(({ index, availableSlots }) => (
            <SelectItem key={index} value={index.toString()} disabled={availableSlots === 0}>
              Node {index}{' '}
              <span className="text-muted-foreground">
                ({availableSlots === 0 ? 'no slots remaining' : `${availableSlots} slots`})
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
