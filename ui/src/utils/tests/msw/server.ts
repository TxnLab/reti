import { http } from 'msw'
import { setupServer } from 'msw/node'
import { handlers } from '@/utils/tests/msw/handlers'

const server = setupServer(...handlers)

export { server, http }
