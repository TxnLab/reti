import { Navigate, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/validators')({
  component: Validators,
})

function Validators() {
  return <Navigate to="/" />
}
