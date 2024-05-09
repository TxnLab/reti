import { CircleX } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface ErrorAlertProps {
  title: string
  message: string
}

export function ErrorAlert({ title, message }: ErrorAlertProps) {
  return (
    <Alert variant="destructive">
      <CircleX className="h-5 w-5 -mt-1" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="text-muted-foreground">{message}</AlertDescription>
    </Alert>
  )
}
