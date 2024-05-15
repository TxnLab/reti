import { isAxiosError } from 'axios'
import { ArrowUpRight, Check } from 'lucide-react'
import { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form'
import { useDebouncedCallback } from 'use-debounce'
import { fetchNfd } from '@/api/nfd'
import { Button } from '@/components/ui/button'
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { getNfdAppFromViteEnvironment } from '@/utils/network/getNfdConfig'
import { isValidName, trimExtension } from '@/utils/nfd'
import { cn } from '@/utils/ui'

const ERROR_NOT_FOUND = 'NFD not found'
const ERROR_NOT_OWNED = 'NFD not owned by active address'
const ERROR_FAILED = 'Failed to fetch NFD'

const NFD_APP_URL = getNfdAppFromViteEnvironment()

interface NfdLookupProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  form: UseFormReturn<TFieldValues>
  name: TName
  nfdAppId: number
  setNfdAppId: (nfdAppId: number) => void
  isFetchingNfd: boolean
  setIsFetchingNfd: (isFetchingNfd: boolean) => void
  watchValue: string
  errorMessage?: string
  activeAddress: string | null
  requireOwner?: boolean
}

export function NfdLookup<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  form,
  name,
  nfdAppId,
  setNfdAppId,
  isFetchingNfd,
  setIsFetchingNfd,
  watchValue,
  errorMessage,
  activeAddress,
  requireOwner = false,
}: NfdLookupProps<TFieldValues, TName>) {
  const fetchNfdAppId = async (value: string) => {
    try {
      const nfd = await fetchNfd(value, { view: 'brief' })

      if (requireOwner && nfd.owner !== activeAddress) {
        throw new Error(ERROR_NOT_OWNED)
      }

      form.clearErrors(name)
      setNfdAppId(nfd.appID!)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      let message: string
      if (isAxiosError(error) && error.response) {
        if (error.response.status === 404) {
          message = ERROR_NOT_FOUND
        } else {
          console.error(error)
          message = ERROR_FAILED
        }
      } else {
        // Handle non-HTTP errors
        console.error(error)
        message = error.message
      }
      form.setError(name, { type: 'manual', message })
    } finally {
      setIsFetchingNfd(false)
    }
  }

  const debouncedFetchNfd = useDebouncedCallback(async (value) => {
    const isValid = await form.trigger(name)
    if (isValid) {
      await fetchNfdAppId(value)
    } else {
      setIsFetchingNfd(false)
    }
  }, 500)

  const showPrimaryMintNfd = (
    name: string,
    isFetching: boolean,
    appId: number,
    errorMsg?: string,
  ) => {
    return !isFetching && appId === 0 && errorMsg === ERROR_NOT_FOUND && isValidName(name)
  }

  const getNfdMintUrl = (name: string, showPrimary: boolean) => {
    return showPrimary ? `${NFD_APP_URL}/mint?q=${trimExtension(name)}` : `${NFD_APP_URL}/mint`
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
                  className={cn(isFetchingNfd || nfdAppId > 0 ? 'pr-10' : '')}
                  placeholder=""
                  autoComplete="new-password"
                  spellCheck="false"
                  {...field}
                  onChange={(e) => {
                    field.onChange(e) // Inform react-hook-form of the change
                    setNfdAppId(0) // Reset NFD app ID
                    setIsFetchingNfd(true) // Set fetching state
                    debouncedFetchNfd(e.target.value) // Perform debounced validation
                  }}
                />
              </FormControl>
              <div
                className={cn(
                  isFetchingNfd || nfdAppId > 0 ? 'opacity-100' : 'opacity-0',
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
                ) : nfdAppId ? (
                  <Check className="h-5 w-5 text-green-500" />
                ) : null}
              </div>
            </div>
            <Button
              size="sm"
              variant={
                showPrimaryMintNfd(watchValue, isFetchingNfd, nfdAppId, errorMessage)
                  ? 'default'
                  : 'outline'
              }
              asChild
            >
              <a
                href={getNfdMintUrl(
                  watchValue,
                  showPrimaryMintNfd(watchValue, isFetchingNfd, nfdAppId, errorMessage),
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ArrowUpRight className="hidden mr-1 h-5 w-5 opacity-75 sm:inline" />
                Mint NFD
              </a>
            </Button>
          </div>
          <FormMessage>{errorMessage}</FormMessage>
        </FormItem>
      )}
    />
  )
}
