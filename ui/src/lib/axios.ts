import Axios from 'axios'
import { setupCache } from 'axios-cache-interceptor'
import { getNfdApiFromViteEnvironment } from '@/utils/network/getNfdConfig'

const instance = Axios.create({
  baseURL: getNfdApiFromViteEnvironment(),
})
const axios = setupCache(instance)

export default axios
