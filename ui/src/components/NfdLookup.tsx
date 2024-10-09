import { AxiosError } from 'axios'
import { ArrowUpRight, Check, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form'
import { useDebouncedCallback } from 'use-debounce'
import { fetchNfd } from '@/api/nfd'
import { Button } from '@/components/ui/button'
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Nfd } from '@/interfaces/nfd'
import { getNfdAppFromViteEnvironment } from '@/utils/network/getNfdConfig'
import { isValidName, trimExtension } from '@/utils/nfd'
import { cn } from '@/utils/ui'

const ERROR_NOT_FOUND = 'NFD not found'
const ERROR_NOT_OWNED = 'NFD not owned by active address'
const ERROR_FAILED = 'Failed to fetch NFD'
const ERROR_UNKNOWN = 'An unknown error occurred'
const WARNING_VERIFIED = 'NFD already has a verified address'

const NFD_APP_URL = getNfdAppFromViteEnvironment()

interface NfdLookupProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  form: UseFormReturn<TFieldValues>
  id: string
  name: TName
  nfd: Nfd | null
  setNfd: (nfd: Nfd | null) => void
  isFetchingNfd: boolean
  setIsFetchingNfd: (isFetchingNfd: boolean) => void
  watchValue: string
  errorMessage?: string
  activeAddress: string | null
  validateOwner?: boolean
  warnVerified?: boolean
}

export function NfdLookup<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  form,
  id,
  name,
  nfd,
  setNfd,
  isFetchingNfd,
  setIsFetchingNfd,
  watchValue,
  errorMessage,
  activeAddress,
  validateOwner = false,
  warnVerified = false,
}: NfdLookupProps<TFieldValues, TName>) {
  const [warningMessage, setWarningMessage] = React.useState('')

  const fetchNfdRecord = async (value: string) => {
    try {
      const nfdRecord = await fetchNfd(value, { view: 'brief' })

      if (validateOwner && nfdRecord.owner !== activeAddress) {
        throw new Error(ERROR_NOT_OWNED)
      }

      if (warnVerified && nfdRecord.caAlgo?.length) {
        setWarningMessage(WARNING_VERIFIED)
      }

      form.clearErrors(name)
      setNfd(nfdRecord)
    } catch (error: unknown) {
      let message: string
      if (error instanceof AxiosError && error.response) {
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
      setIsFetchingNfd(false)
    }
  }

  const debouncedFetchNfd = useDebouncedCallback(async (value) => {
    const isValid = await form.trigger(name)
    if (isValid) {
      await fetchNfdRecord(value)
    } else {
      setIsFetchingNfd(false)
    }
  }, 500)

  const showPrimaryMintNfd = (
    name: string,
    isFetching: boolean,
    nfdRecord: Nfd | null,
    errorMsg?: string,
  ) => {
    return !isFetching && nfdRecord === null && errorMsg === ERROR_NOT_FOUND && isValidName(name)
  }

  const getNfdMintUrl = (name: string, showPrimary: boolean) => {
    return showPrimary ? `${NFD_APP_URL}/mint?q=${trimExtension(name)}` : `${NFD_APP_URL}/mint`
  }

  const renderMessage = () => {
    if (errorMessage) {
      return errorMessage
    }

    if (warningMessage) {
      return (
        <span className="inline-flex items-center gap-x-1.5 text-amber-600 dark:text-amber-500">
          <TriangleAlert className="h-4 w-4" />
          {warningMessage}
        </span>
      )
    }

    return null
  }

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="sm:col-span-2">
          <div className="flex items-center gap-x-3">
            <div className="flex-1 relative">
              <FormControl>
                <Input
                  id={id}
                  className={cn(isFetchingNfd || nfd ? 'pr-10' : '')}
                  placeholder=""
                  autoComplete="new-password"
                  spellCheck="false"
                  {...field}
                  onChange={(e) => {
                    field.onChange(e) // Inform react-hook-form of the change
                    setNfd(null) // Unset NFD record
                    setWarningMessage('') // Reset verified warning
                    setIsFetchingNfd(true) // Set fetching state
                    debouncedFetchNfd(e.target.value) // Perform debounced validation
                  }}
                />
              </FormControl>
              <div
                className={cn(
                  isFetchingNfd || nfd ? 'opacity-100' : 'opacity-0',
                  'pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3',
                )}
              >
                {isFetchingNfd ? (
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
                ) : nfd ? (
                  <Check className="h-5 w-5 text-green-500" />
                ) : null}
              </div>
            </div>
            <Button
              size="sm"
              variant={
                showPrimaryMintNfd(watchValue, isFetchingNfd, nfd, errorMessage)
                  ? 'default'
                  : 'outline'
              }
              asChild
            >
              <a
                href={getNfdMintUrl(
                  watchValue,
                  showPrimaryMintNfd(watchValue, isFetchingNfd, nfd, errorMessage),
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ArrowUpRight className="hidden mr-1 h-5 w-5 opacity-75 sm:inline" />
                Mint NFD
              </a>
            </Button>
          </div>
          <FormMessage>{renderMessage()}</FormMessage>
        </FormItem>
      )}
    />
  )
}
