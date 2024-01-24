## Staking

* User wants to add stake to a validator
  * First has to determine where the user is already staked - could be in multiple validators
    * Need way to efficiently get list of validator pools the account is in (multiple for same validator is possible)
  * If not in an existing pool, need to find a free pool (w/in balance range), if not available need to create a new pool 
* Creating a pool

## Methods

* addValidator(owner, manager, nfdAppID, validatorConfig{payoutDays, validatorPct, poolsPerNode, maxNodes)
  * returns a validator id

### Validator actions
* addPool(validatorId)
  * returns ValidatorPoolKey {ID, PoolID}
  * Must be called by owner or manager of validator - adds a new pool up to max pools

### User action
* Wants to stake to a validator
  * addStake(validatorId) 
  * Fetches from StakerPoolList (up to 4 validator/pool entries) and determines if already present
    * Only allow to be in 1 pool per validator ??
    * Can't search every pool for a validator as each is a different box - so then track which pool has space?
    * If NOT - then stakes to that validator in next 'free' slot
    * If found - then adds more in that existing pool and slot

* Pool tracking
  * Knows how much 
