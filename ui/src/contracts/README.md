## How to connect my web app with Algorand smart contracts?

The following folder is reserved for the Algorand Application Clients. The clients are used to interact with instances of Algorand Smart Contracts (ASC1s) deployed on-chain.

To integrate this react frontend template with your smart contracts codebase, perform the following steps:

1. Generate the typed client using `algokit generate client -l typescript -o {path/to/this/folder}`
2. The generated typescript client should be ready to be imported and used in this react frontend template, making it a full fledged dApp.

### FAQ

- **How to interact with the smart contract?**
  - The generated client provides a set of functions that can be used to interact with the ABI (Application Binary Interface) compliant Algorand smart contract. For example, if the smart contract has a function called `hello`, the generated client will have a function called `hello` that can be used to interact with the smart contract. Refer to a [full-stack end-to-end starter template](https://github.com/algorandfoundation/algokit-fullstack-template) for a reference example on invoking and interacting with typescript typed clients generated.
