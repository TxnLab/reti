import { Check } from 'lucide-react'
import * as React from 'react'
import { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form'
import { useDebouncedCallback } from 'use-debounce'
import { fetchAsset as fetchAssetInformation } from '@/api/algod'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { AlgodHttpError, Asset } from '@/interfaces/algod'
import { cn } from '@/utils/ui'

const ERROR_EMPTY_FIELD = 'No asset ID entered'
const ERROR_NOT_FOUND = 'Asset not found'
const ERROR_FAILED = 'Failed to fetch asset'
const ERROR_UNKNOWN = 'An unknown error occurred'

interface AssetLookupProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  form: UseFormReturn<TFieldValues>
  name: TName
  asset: Asset | null
  setAsset: (asset: Asset | null) => void
  isFetching: boolean
  setIsFetching: (isFetching: boolean) => void
  errorMessage?: string
  label?: React.ReactNode
  className?: string
}

export function AssetLookup<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  form,
  name,
  asset,
  setAsset,
  isFetching,
  setIsFetching,
  errorMessage,
  label,
  className = '',
}: AssetLookupProps<TFieldValues, TName>) {
  const fetchAsset = async (value: string) => {
    try {
      if (!value) {
        // If the field is empty, set a validation error but don't throw an error
        form.setError(name, { type: 'manual', message: ERROR_EMPTY_FIELD })
        return
      }

      const asset = await fetchAssetInformation(Number(value))

      form.clearErrors(name)
      setAsset(asset)
    } catch (error: unknown) {
      let message: string
      if (error instanceof AlgodHttpError && error.response) {
        // Handle HTTP errors
        if (error.response.status === 404) {
          message = ERROR_NOT_FOUND
        } else {
          console.error(error)
          message = ERROR_FAILED
        }
      } else if (error instanceof Error) {
        // Handle non-HTTP errors
        console.error(error)
        message = error.message
      } else {
        // Handle unknown errors
        console.error(error)
        message = ERROR_UNKNOWN
      }
      form.setError(name, { type: 'manual', message })
    } finally {
      setIsFetching(false)
    }
  }

  const debouncedFetchAsset = useDebouncedCallback(async (value) => {
    const isValid = await form.trigger(name)
    if (isValid) {
      await fetchAsset(value)
    } else {
      setIsFetching(false)
    }
  }, 500)

  React.useEffect(() => {
    const initialFetch = async () => {
      if (form.getValues(name)) {
        await fetchAsset(form.getValues(name))
      }
    }

    initialFetch()
  }, [])

  const renderLabel = () => {
    if (typeof label === 'string') {
      return <FormLabel>{label}</FormLabel>
    }

    if (label) {
      return label
    }

    return null
  }

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          {renderLabel()}
          <div className="flex items-center gap-x-3">
            <div className="flex-1 relative">
              <FormControl>
                <Input
                  className={cn(isFetching || asset ? 'pr-28' : '')}
                  autoComplete="new-password"
                  spellCheck="false"
                  {...field}
                  onChange={(e) => {
                    field.onChange(e) // Inform react-hook-form of the change
                    setAsset(null) // Reset asset
                    setIsFetching(true) // Set fetching state
                    debouncedFetchAsset(e.target.value) // Perform debounced validation
                  }}
                />
              </FormControl>
              <div
                className={cn(
                  isFetching || asset ? 'opacity-100' : 'opacity-0',
                  'pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3',
                )}
              >
                {isFetching ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5 animate-spin opacity-25"
                    aria-hidden="true"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : asset ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-muted-foreground">
                      {asset.params['unit-name']}
                    </span>
                    <Check className="h-5 w-5 text-green-500" />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <FormMessage>{errorMessage}</FormMessage>
        </FormItem>
      )}
    />
  )
}
