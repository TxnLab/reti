import {
  ExplorerConfig,
  getExplorerConfigFromViteEnvironment,
} from '@/utils/network/getExplorerConfig'

export class ExplorerLink {
  private config: ExplorerConfig
  private identifier: string

  constructor(identifier: string) {
    this.config = getExplorerConfigFromViteEnvironment()
    this.identifier = identifier
  }

  accountUrl() {
    return `${this.config.accountUrl}/${this.identifier}`
  }

  transactionUrl() {
    return `${this.config.transactionUrl}/${this.identifier}`
  }

  assetUrl() {
    return `${this.config.assetUrl}/${this.identifier}`
  }

  appUrl() {
    return `${this.config.appUrl}/${this.identifier}`
  }

  static account(address: string) {
    return new ExplorerLink(address).accountUrl()
  }

  static tx(id: string) {
    return new ExplorerLink(id).transactionUrl()
  }

  static asset(id: number | bigint) {
    return new ExplorerLink(Number(id).toString()).assetUrl()
  }

  static app(id: number | bigint) {
    return new ExplorerLink(Number(id).toString()).appUrl()
  }
}
