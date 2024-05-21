import { useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import { ArrowDownLeft } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { claimTokens } from '@/api/contracts'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Validator } from '@/interfaces/validator'
import { useAuthAddress } from '@/providers/AuthAddressProvider'
import { formatAssetAmount } from '@/utils/format'

interface ClaimTokensProps {
  validator: Validator
  rewardTokenBalance: bigint
}

export function ClaimTokens({ validator, rewardTokenBalance }: ClaimTokensProps) {
  const { transactionSigner, activeAddress } = useWallet()
  const { authAddress } = useAuthAddress()
  const queryClient = useQueryClient()

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const handleClaimTokens = async () => {
    const toastId = `${TOAST_ID}-claim-tokens`

    try {
      if (!activeAddress) {
        throw new Error('No wallet connected')
      }

      if (!validator.rewardToken) {
        throw new Error('No reward token found')
      }

      if (!rewardTokenBalance) {
        throw new Error('No tokens to claim')
      }

      toast.loading('Sign transactions to claim reward tokens...', { id: toastId })

      await claimTokens(validator.pools, transactionSigner, activeAddress, authAddress)

      toast.success(
        <div className="flex items-center gap-x-2">
          <ArrowDownLeft className="h-5 w-5 text-foreground" />
          <span>Claimed {formatAssetAmount(validator.rewardToken, rewardTokenBalance)}</span>
        </div>,
        {
          id: toastId,
          duration: 5000,
        },
      )

      queryClient.invalidateQueries({ queryKey: ['stakes', { staker: activeAddress }] })
    } catch (error) {
      toast.error('Failed to claim tokens', { id: toastId })
      console.error(error)
    }
  }

  if (!validator.config.rewardTokenId) {
    return null
  }

  return (
    <DropdownMenuItem onClick={handleClaimTokens} disabled={!rewardTokenBalance}>
      Claim Tokens
    </DropdownMenuItem>
  )
}
