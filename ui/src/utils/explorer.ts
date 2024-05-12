import {
  ExplorerConfig,
  getExplorerConfigFromViteEnvironment,
} from '@/utils/network/getExplorerConfig'

export class ExplorerLink {
  private config: ExplorerConfig
  private identifier: string

  private constructor(identifier: string) {
    this.config = getExplorerConfigFromViteEnvironment()
    this.identifier = identifier
  }

  private accountUrl() {
    return `${this.config.accountUrl}/${this.identifier}`
  }

  private transactionUrl() {
    return `${this.config.transactionUrl}/${this.identifier}`
  }

  private assetUrl() {
    return `${this.config.assetUrl}/${this.identifier}`
  }

  private appUrl() {
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
