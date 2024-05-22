import Axios from 'axios'
import { setupCache } from 'axios-cache-interceptor'
import queryString from 'query-string'
import { getNfdApiFromViteEnvironment } from '@/utils/network/getNfdConfig'

const instance = Axios.create({
  baseURL: getNfdApiFromViteEnvironment(),
  paramsSerializer: (params) => queryString.stringify(params),
})
const axios = setupCache(instance)

export default axios
