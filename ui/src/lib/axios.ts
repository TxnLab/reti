import Axios from 'axios'
import { setupCache } from 'axios-cache-interceptor'
import { getNfdApiFromViteEnvironment } from '@/utils/network/getNfdApiConfig'

const instance = Axios.create({
  baseURL: getNfdApiFromViteEnvironment(),
})
const axios = setupCache(instance)

export default axios
