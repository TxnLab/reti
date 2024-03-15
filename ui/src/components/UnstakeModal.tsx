import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useWallet } from '@txnlab/use-wallet'
import * as React from 'react'
import { toast } from 'sonner'
import { removeStake } from '@/api/contracts'
import { Button } from '@/components/ui/button'
import { ValidatorStake } from '@/interfaces/staking'
import { Validator } from '@/interfaces/validator'

interface UnstakeModalProps {
  validatorStake: ValidatorStake
}

export function UnstakeModal({ validatorStake }: UnstakeModalProps) {
  const [isSigning, setIsSigning] = React.useState<boolean>(false)

  const queryClient = useQueryClient()
  const router = useRouter()
  const { signer, activeAddress } = useWallet()

  const toastIdRef = React.useRef(`toast-${Date.now()}-${Math.random()}`)
  const TOAST_ID = toastIdRef.current

  const handleUnstake = async () => {
    const toastId = `${TOAST_ID}-unstake`

    try {
      setIsSigning(true)

      if (!activeAddress) {
        throw new Error('No active address')
      }

      // Unstake the full amount
      const amountToUnstake = AlgoAmount.MicroAlgos(0).microAlgos

      toast.loading('Sign transactions to remove stake...', { id: toastId })

      await removeStake(validatorStake.poolKey.poolAppId, amountToUnstake, signer, activeAddress)

      toast.success(
        `Stake removed from pool ${validatorStake.poolKey.poolId} on validator ${validatorStake.poolKey.validatorId}!`,
        {
          id: toastId,
          duration: 5000,
        },
      )

      const stakesData = queryClient.getQueryData<ValidatorStake[]>([
        'stakes',
        { staker: activeAddress },
      ])

      // This will change when multiple stakes (pools) per validator are combined
      const remainingStakesForValidator =
        stakesData
          ?.filter((s) => s.poolKey.poolId !== validatorStake.poolKey.poolId)
          .filter((s) => s.poolKey.validatorId === validatorStake.poolKey.validatorId) || []

      const allStakeRemoved = remainingStakesForValidator.length === 0

      queryClient.setQueryData<ValidatorStake[]>(
        ['stakes', { staker: activeAddress }],
        (prevData) => {
          if (!prevData) {
            return prevData
          }

          return prevData.filter((s) => s.poolKey.poolId !== validatorStake.poolKey.poolId)
        },
      )

      queryClient.setQueryData<Validator>(
        ['validator', { validatorId: validatorStake.poolKey.validatorId.toString() }],
        (prevData) => {
          if (!prevData) {
            return prevData
          }

          return {
            ...prevData,
            numStakers: allStakeRemoved ? prevData.numStakers - 1 : prevData.numStakers,
            totalStaked: prevData.totalStaked - validatorStake.balance,
          }
        },
      )

      queryClient.setQueryData<Validator[]>(['validators'], (prevData) => {
        if (!prevData) {
          return prevData
        }

        return prevData.map((v: Validator) => {
          if (v.id === validatorStake.poolKey.validatorId) {
            return {
              ...v,
              numStakers: allStakeRemoved ? v.numStakers - 1 : v.numStakers,
              totalStaked: v.totalStaked - validatorStake.balance,
            }
          }

          return v
        })
      })

      router.invalidate()
    } catch (error) {
      toast.error('Failed to remove stake from pool', { id: toastId })
      console.error(error)
    } finally {
      setIsSigning(false)
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={handleUnstake} disabled={isSigning}>
      Unstake
    </Button>
  )
}
