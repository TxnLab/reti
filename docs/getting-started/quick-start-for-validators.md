# Quick Start For Validators

## Setting Up a Node

The first step is to run a node. Find a number of different resources in [Running a Node](../resources/running-a-node.md) if you don't already have one running.

## Define Validator

Validators can define a number of parameters - some of which are immutable. More information on each parameter can be found in [Validators](../core-concepts/validators.md).

**Mandatory Parameters**

* owner address
* manager address
* Payout frequency
* Validator commission rate
* Validator fee address
* Minimum entry amount
* Maximum stake per pool (if the validator wants to limit it in some way).  Default value will have max stake be same as max allowed and still receive incentives.
* Number of pools per node (participation keys) - Maximum of 3
* Max number of nodes - Maximum of 8
  * This means a maximum of 24 pools can be created.

**Optional Parameters**

* Link an NFD to the Validator&#x20;
* Reward token / reward rate
* Sunsetting information
* Token / NFD Gating:&#x20;
  * Supported gating options include:
    * Tokens/NFTs by creator and min amount
    * Specific ASA id
    * Tokens/NFTs created by any address linked within a particular NFD.
    * Owning a segment of a particular NFD Root

