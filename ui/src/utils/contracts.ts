import {
  NodeInfo,
  NodePoolAssignmentConfig,
  RawNodePoolAssignmentConfig,
  Validator,
  ValidatorConfig,
  ValidatorConfigRaw,
  ValidatorState,
  ValidatorStateRaw,
} from '@/interfaces/validator'

export function transformValidatorData(
  rawConfig: ValidatorConfigRaw,
  rawState: ValidatorStateRaw,
): Validator {
  const config: ValidatorConfig = {
    ID: rawConfig[0],
    Owner: rawConfig[1],
    Manager: rawConfig[2],
    NFDForInfo: rawConfig[3],
    MustHoldCreatorNFT: rawConfig[4],
    CreatorNFTMinBalance: rawConfig[5],
    RewardTokenID: rawConfig[6],
    RewardPerPayout: rawConfig[7],
    PayoutEveryXMins: rawConfig[8],
    PercentToValidator: rawConfig[9],
    ValidatorCommissionAddress: rawConfig[10],
    MinEntryStake: rawConfig[11],
    MaxAlgoPerPool: rawConfig[12],
    PoolsPerNode: rawConfig[13],
  }

  const state: ValidatorState = {
    NumPools: rawState[0],
    TotalStakers: rawState[1],
    TotalAlgoStaked: rawState[2],
  }

  return {
    id: Number(config.ID),
    owner: config.Owner,
    manager: config.Manager,
    nfd: Number(config.NFDForInfo),
    payoutFrequency: Number(config.PayoutEveryXMins),
    commission: Number(config.PercentToValidator),
    commissionAccount: config.ValidatorCommissionAddress,
    minStake: Number(config.MinEntryStake),
    maxStake: Number(config.MaxAlgoPerPool),
    maxPools: Number(config.PoolsPerNode),
    numPools: Number(state.NumPools),
    numStakers: Number(state.TotalStakers),
    totalStaked: Number(state.TotalAlgoStaked),
  }
}

export function transformNodePoolAssignment(
  rawConfig: RawNodePoolAssignmentConfig,
): NodePoolAssignmentConfig {
  return rawConfig[0].flat()
}

export function processNodePoolAssignment(
  nodes: NodePoolAssignmentConfig,
  maxPoolsPerNode: number,
): NodeInfo[] {
  return nodes.map((nodeConfig, index) => {
    const availableSlots = nodeConfig.filter(
      (slot, i) => i < maxPoolsPerNode && slot === BigInt(0),
    ).length

    return {
      index: index + 1,
      availableSlots,
    }
  })
}

export function validatorHasAvailableSlots(
  nodePoolAssignmentConfig: NodePoolAssignmentConfig,
  maxPoolsPerNode: number,
): boolean {
  return nodePoolAssignmentConfig.some((nodeConfig) => {
    const slotIndex = nodeConfig.indexOf(BigInt(0))
    return slotIndex !== -1 && slotIndex < maxPoolsPerNode
  })
}

export function findFirstAvailableNode(
  nodePoolAssignmentConfig: NodePoolAssignmentConfig,
  maxPoolsPerNode: number,
): number | null {
  for (let nodeIndex = 0; nodeIndex < nodePoolAssignmentConfig.length; nodeIndex++) {
    const slotIndex = nodePoolAssignmentConfig[nodeIndex].indexOf(BigInt(0))
    if (slotIndex !== -1 && slotIndex < maxPoolsPerNode) {
      return nodeIndex + 1
    }
  }
  return null // No available slot found
}
