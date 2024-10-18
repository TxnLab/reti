# Reti Open Pooling

## Documentation

These contracts, node daemon, and UI are for the proposal described in [Reti Open Pooling](../docs/reti-open-pooling.md).

The contracts themselves are written in Tealscript. See [Tealscript](https://tealscript.algo.xyz) for details.

## Usage

### Algokit

This repository assumes you have [AlgoKit](https://github.com/algorandfoundation/algokit-cli) installed and have a local network running on your machine.  Run `pnpm run localnet` to start a specially configured trunk version of the node that supports the (still unreleased AVM 11) and that also configures a smaller amount of stake for tests.  This special localnet sandbox is required for the system tests as they manipulate the block time offsets.

### PNPM

The PNPM package manager was used for this project. See [pnpm](https://pnpm.io/) for installation details. Be sure to `pnpm install` first.

### Build Contracts

`pnpm run build` will compile the contracts to TEAL and generate ABI and appspec JSON files in [./contracts/artifacts](./contracts/artifacts/) and AlgoKit TypeScript clients in [./contracts/clients](./contracts/clients/).

`pnpm run compile-contract` or `pnpm run generate-client` can be used to compile the contract or generate the contract seperately.

### Run Tests

`pnpm run test` will execute the tests defined in [./\_\_test\_\_](./__test__)

## Deploying

### Bootstrap script

A bootstrap script is in the ./bootstrap directory. Running `pnpm run bootstrap --network {network}` will bootstrap the validator. The localnet network bootstraps the local sandbox and also funds two new test accounts - updating an .env.sandbox file inside the nodemgr directory for local CLI use/testing. It is recommended to use a named sandbox configuration that has devmode disabled so blocks proceed normally.
