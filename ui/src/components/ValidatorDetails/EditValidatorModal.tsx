import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/utils/ui'

interface EditValidatorModalProps {
  title: string
  description: string
  open: boolean
  onOpenChange: (open: boolean) => void
  className?: string
  children?: React.ReactNode
}

export function EditValidatorModal({
  title,
  description,
  open,
  onOpenChange,
  className = '',
  children,
}: EditValidatorModalProps) {
  return (
    <div className="w-10 -my-2">
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-foreground"
          >
            <Settings2 className="h-5 w-5" />
          </Button>
        </DialogTrigger>
        <DialogContent className={cn('max-w-[640px]', className)}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    </div>
  )
}
