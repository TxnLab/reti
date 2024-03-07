import { Navigate, createFileRoute, redirect } from '@tanstack/react-router'
import { isWalletConnected } from '@/utils/wallets'

export const Route = createFileRoute('/validators')({
  beforeLoad: async () => {
    if (!isWalletConnected()) {
      throw redirect({
        to: '/',
      })
    }
  },
  component: Validators,
})

function Validators() {
  return <Navigate to="/dashboard" />
}
