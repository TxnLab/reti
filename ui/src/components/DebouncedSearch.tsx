import { X } from 'lucide-react'
import * as React from 'react'
import { DebouncedInput, DebouncedInputProps } from '@/components/DebouncedInput'
import { Button } from '@/components/ui/button'
import { cn } from '@/utils/ui'

export interface DebouncedSearchProps extends Omit<DebouncedInputProps, 'onChange'> {
  onSearch: (value: string | number) => void
}

export function DebouncedSearch({
  value: initialValue,
  onSearch,
  debounce,
  className = '',
  ...props
}: DebouncedSearchProps) {
  const [value, setValue] = React.useState(initialValue)

  React.useEffect(() => {
    onSearch(value)
  }, [value])

  const handleClear = () => {
    setValue('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      handleClear()
    }
  }

  return (
    <div className="relative">
      <DebouncedInput
        value={value}
        onChange={setValue}
        debounce={debounce}
        onKeyDown={handleKeyDown}
        {...props}
        className={cn(className, { 'pr-10': value !== '' })}
      />
      {value !== '' && (
        <Button
          variant="ghost"
          size="icon"
          className="group absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6"
          onClick={handleClear}
        >
          <X className="h-4 w-4 opacity-60 transition-opacity group-hover:opacity-100" />
        </Button>
      )}
    </div>
  )
}
