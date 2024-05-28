# Réti Open Pooling

Welcome to the Réti Open Pooling monorepo. This README provides instructions for running the protocol and its accompanying example UI in a local environment. Detailed protocol information and its objectives can be found in the [Gitbook documentation](https://txnlab.gitbook.io/reti-open-pooling).

## Overview

The Réti Open Pooling protocol enables the creation of decentralized staking pools on the Algorand network, promoting broader participation and enhancing network security through diversification. It is designed to be open-source, non-custodial, and fully decentralized, allowing for the creation and joining of staking pools to meet the minimum stake required for node rewards on Algorand.

## Prerequisites

Before starting, ensure you have the following installed:
- **Docker**: Required for running AlgoKit. [Installation guide](https://www.docker.com/get-started).
- **AlgoKit**: Version 2.0 or later is required. [Installation guide](https://github.com/algorandfoundation/algokit-cli#install). Verify by running `algokit --version`.
- **PNPM**: Version 8.0 or later for package management. [Installation guide](https://pnpm.io/installation). Verify by running `pnpm --version`.

## Quick Start

This section provides instructions for running the protocol and UI in a local AlgoKit sandbox environment.

- **Clone the repository**

	```bash
	git clone https://github.com/TxnLab/reti.git
	```

- **Navigate to the `reti` directory**

	```bash
	cd reti
	```

- **Install dependencies**

	```bash
	pnpm install
	```

- **Start the local network**

	```bash
	algokit localnet start
	```

- **Bootstrap the validator**
	
	This command bootstraps a new master validator and funds two new test accounts. It also sets environment variables for LocalNet that will be used by the front-end.
	```bash
	pnpm run bootstrap
	```

- **Launch the UI**

	```bash
	pnpm run dev
	```

## TestNet Development

- **Navigate to the `ui` directory**

	```bash
	cd ui
	```

- **Create a `.env.testnet` file**

	Copy the TestNet variables from the [`.env.template`](./ui/.env.template) file into a new `.env.testnet` file. Check back often to make sure you're using the latest master validator app ID, set to `VITE_RETI_APP_ID`.

- **Launch the UI**

	```bash
	pnpm run dev:testnet
	```

## Additional Resources

- **TEALScript Contracts**: Explore the smart contracts that power the protocol. [Read more](./contracts/README.md)
- **Node Daemon**: Learn about the CLI / service daemon which node runners will run as a background service. [Read more](https://txnlab.gitbook.io/reti-open-pooling/technical-implementation/reti-node-daemon)
- **Example UI**: A Vite React project that serves as a dashboard for staking and validator management. [Read more](./ui/README.md)

## Discord

For questions or technical support, you can reach us in the **#reti** channel on NFD's Discord: https://discord.gg/w6vSwG5bFK
