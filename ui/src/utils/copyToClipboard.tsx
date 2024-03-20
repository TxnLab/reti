import copy from 'copy-to-clipboard'
import { toast } from 'sonner'

export function copyToClipboard(event: React.MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
  const text = event.currentTarget.getAttribute('data-clipboard-text') as string

  if (navigator.clipboard) {
    // Use Clipboard API if available
    navigator.clipboard
      .writeText(text)
      .then(() => {
        toast.message('Copied to clipboard', {
          description: text,
        })
      })
      .catch(() => {
        toast.error('Copying to clipboard failed')
      })
  } else {
    // Fallback method if Clipboard API is not available
    try {
      copy(text)
      toast.message('Copied to clipboard', {
        description: text,
      })
    } catch (error) {
      toast.error('Copying to clipboard failed')
    }
  }
}
